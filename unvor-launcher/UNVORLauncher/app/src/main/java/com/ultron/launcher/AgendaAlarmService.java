package com.ultron.launcher;
import android.app.*;import android.content.*;import android.media.*;import android.os.*;import org.json.*;
/** Finite, local alarm playback. No microphone and no network access. */
public final class AgendaAlarmService extends Service {
 static volatile String activeId;
 private JSONObject currentRow;private int audioGeneration;
 private MediaPlayer player;private AudioManager audio;private AudioFocusRequest focus;private final Handler handler=new Handler(Looper.getMainLooper());private PowerManager.WakeLock wake;
 @Override public IBinder onBind(Intent i){return null;}
 @Override public int onStartCommand(Intent intent,int flags,int startId){if(intent==null||"STOP".equals(intent.getAction())){stopSelf();return START_NOT_STICKY;}
  try{String id=intent.getStringExtra("id");activeId=id;JSONObject row=null;JSONArray rows=AgendaStore.list(this);for(int i=0;i<rows.length();i++)if(rows.getJSONObject(i).getString("id").equals(id))row=rows.getJSONObject(i);if(row==null){stopSelf();return START_NOT_STICKY;}
   currentRow=row;NotificationManager nm=(NotificationManager)getSystemService(NOTIFICATION_SERVICE);NotificationChannel channel=new NotificationChannel("agenda-alarms","Sveglie agenda UNVOR",NotificationManager.IMPORTANCE_HIGH);channel.setSound(null,null);nm.createNotificationChannel(channel);startForeground(101,AgendaReceiver.notification(this,row,"agenda-alarms",true));
   releaseAudio();AudioAttributes attr=new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build();audio=(AudioManager)getSystemService(AUDIO_SERVICE);final int audioToken=++audioGeneration;focus=new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT).setAudioAttributes(attr).setOnAudioFocusChangeListener(change->{if(change<0&&audioToken==audioGeneration)stopSelf();}).build();if(audio.requestAudioFocus(focus)!=AudioManager.AUDIOFOCUS_REQUEST_GRANTED){stopSelf();return START_NOT_STICKY;}
   player=new MediaPlayer();player.setAudioAttributes(attr);android.net.Uri uri=RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);if(uri==null)uri=RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);player.setDataSource(this,uri);player.setLooping(true);player.prepare();player.start();wake=((PowerManager)getSystemService(POWER_SERVICE)).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK,"ultron:agenda-alarm");wake.acquire(125000);handler.removeCallbacksAndMessages(null);handler.postDelayed(this::stopSelf,120000);
  }catch(Exception e){if(currentRow!=null)AgendaReceiver.fallback(this,currentRow);stopSelf();}return START_NOT_STICKY;
 }
 private void releaseAudio(){audioGeneration++;if(player!=null){try{player.stop();}catch(Exception ignored){}player.release();player=null;}if(audio!=null&&focus!=null){audio.abandonAudioFocusRequest(focus);focus=null;}if(wake!=null&&wake.isHeld())wake.release();wake=null;}
 @Override public void onDestroy(){activeId=null;handler.removeCallbacksAndMessages(null);releaseAudio();stopForeground(true);super.onDestroy();}
}
