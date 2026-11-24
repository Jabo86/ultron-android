package com.ultron.launcher;
import android.content.Context;import android.os.*;import org.vosk.*;import org.vosk.android.*;import org.json.*;import java.io.*;import java.util.concurrent.*;import java.util.concurrent.atomic.AtomicInteger;
/** Vosk lives entirely on device. Audio is consumed from memory and never saved. */
public final class OfflineVoice {
 public interface Callback{void state(String s);void text(String s);void error(String s);void wake(String command);}
 private final Context context;private final Callback callback;private final ExecutorService worker=Executors.newSingleThreadExecutor();private final Handler main=new Handler(Looper.getMainLooper());private final AtomicInteger generation=new AtomicInteger();private Model model;private SpeechService service;private Recognizer recognizer;private volatile boolean closed;
 public OfflineVoice(Context c,Callback cb){context=c.getApplicationContext();callback=cb;}
 private void model()throws IOException{if(model!=null)return;File root=new File(context.getNoBackupFilesDir(),"voice-it-022");File marker=new File(root,"complete");if(!marker.exists()){copy("voice-it",root);try(FileOutputStream out=new FileOutputStream(marker)){out.write(1);}}LibVosk.setLogLevel(LogLevel.WARNINGS);model=new Model(root.getAbsolutePath());}
 private void copy(String path,File target)throws IOException{String[] children=context.getAssets().list(path);if(children!=null&&children.length>0){if(!target.isDirectory()&&!target.mkdirs())throw new IOException("Spazio insufficiente per il modello");for(String n:children)copy(path+"/"+n,new File(target,n));}else try(InputStream in=context.getAssets().open(path);FileOutputStream out=new FileOutputStream(target)){byte[] b=new byte[32768];int n;while((n=in.read(b))!=-1)out.write(b,0,n);}}
 public void warm(){if(!closed)worker.execute(()->{try{model();}catch(Exception|LinkageError ignored){}});}
 private static final java.util.regex.Pattern WAKE = java.util.regex.Pattern.compile(
     "^(?:ehi|hey|ei|hei) (?:unvor|un vor|un bor|un war|un for|un or|un vo)(?: |$)");
 public void start(){start(false);}
 public void listenForWake(){start(true);}
 private void start(boolean watch){if(closed)return;final int token=generation.incrementAndGet();callback.state(watch?"armed":"processing");worker.execute(()->{try{cleanup();model();if(closed||generation.get()!=token)return;recognizer=new Recognizer(model,16000f);service=new SpeechService(recognizer,16000f);RecognitionListener listener=new RecognitionListener(){
   private boolean valid(){return!closed&&generation.get()==token;}
   private boolean detected;
   public void onPartialResult(String s){
     if(!valid()||!watch||detected)return;
     try{String partial=LocalCommands.normalize(new JSONObject(s).optString("partial"));
       if(WAKE.matcher(partial).find()){detected=true;callback.state("listening");}
     }catch(JSONException ignored){}
   }
   private void result(String json){if(!valid())return;try{String text=new JSONObject(json).optString("text","").trim();if(watch){
     java.util.regex.Matcher match=WAKE.matcher(LocalCommands.normalize(text));
     if(match.find()){String command=LocalCommands.normalize(text).substring(match.end()).trim();stop();callback.wake(command);}
     else if(detected){detected=false;callback.state("armed");}
   }else if(!text.isEmpty()){stop();callback.text(text);}}catch(Exception e){stop();callback.error("Comando non riconosciuto");}}
   public void onResult(String s){result(s);}public void onFinalResult(String s){result(s);if(valid()){stop();callback.error("Nessun comando riconosciuto");}}
   public void onError(Exception e){if(valid()){stop();callback.error("Microfono non disponibile");}}
   public void onTimeout(){if(valid()){stop();callback.error("Ascolto terminato. Tocca il globo per riprovare.");}}
  };boolean started=watch?service.startListening(listener):service.startListening(listener,15000);if(!started)throw new IOException("Microfono occupato");main.post(()->{if(generation.get()==token&&!closed)callback.state(watch?"armed":"listening");});
 }catch(Exception|LinkageError e){main.post(()->{if(generation.get()==token&&!closed){stop();callback.error("Motore vocale locale non disponibile. Usa il comando scritto e segnala l’errore.");}});}});}
 private void cleanup(){if(service!=null){service.cancel();service.shutdown();service=null;}if(recognizer!=null){recognizer.close();recognizer=null;}}
 public void stop(){generation.incrementAndGet();callback.state("idle");if(!closed)worker.execute(this::cleanup);}
 public void close(){generation.incrementAndGet();closed=true;worker.execute(()->{cleanup();if(model!=null){model.close();model=null;}});worker.shutdown();}
}
