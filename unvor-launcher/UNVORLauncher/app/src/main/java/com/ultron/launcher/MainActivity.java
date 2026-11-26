package com.ultron.launcher;

import android.Manifest;
import android.app.*;
import android.content.*;
import android.content.pm.*;
import android.database.Cursor;
import android.graphics.*;
import android.graphics.drawable.Drawable;
import android.net.Uri;
import android.os.*;
import android.provider.*;
import android.speech.tts.*;
import android.util.Base64;
import android.view.*;
import android.webkit.*;
import android.widget.*;
import org.json.*;
import java.io.*;
import java.text.*;
import java.util.*;
import java.util.concurrent.*;

/** Local packaged UI; the sole JS bridge dispatches a closed set of native actions. */
public final class MainActivity extends Activity {
    private WebView web;
    private FrameLayout root;
    private SharedPreferences prefs;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    // App discovery renders icons and may take seconds: never queue a tap behind it.
    private final ExecutorService appsIo = Executors.newSingleThreadExecutor();
    private final ExecutorService launchIo = Executors.newSingleThreadExecutor();
    private volatile Set<String> knownLaunchTargets = Collections.emptySet();
    private volatile JSONArray cachedApps;
    private volatile long cachedAppsAt;
    private static final long APP_CACHE_MS = 60_000L;
    private boolean visible, ready;
    private OfflineVoice offline;
    private PersonalAi personalAi;
    private LatestNews latestNews;
    private String pendingContactName,pendingPhone;
    private final Map<String,String> callChoices=new HashMap<>();
    private long choicesExpire;
    private String pendingPermission;
    private TextToSpeech tts;
    private boolean ttsReady;
    private boolean ttsInitializing;
    private int ttsInitToken;
    private String queuedSpeech;
    private int queuedSpeechGeneration;
    private int speechGeneration;
    private String voicePhase="idle";
    private boolean homeCovered, wakeFault;
    private final Runnable armWake = () -> {
        if(visible && ready && !homeCovered && !wakeFault && offline!=null && prefs.getBoolean("wake_on_home",false)
                && "idle".equals(voicePhase) && !ttsInitializing && queuedSpeech==null
                && checkSelfPermission(Manifest.permission.RECORD_AUDIO)==PackageManager.PERMISSION_GRANTED) offline.listenForWake();
    };
    private void scheduleWake(){main.removeCallbacks(armWake);if(visible)main.postDelayed(armWake,650);}
    private void configureWake(boolean enabled){
        if(enabled && checkSelfPermission(Manifest.permission.RECORD_AUDIO)!=PackageManager.PERMISSION_GRANTED){
            pendingPermission="wake";requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO},45);return;
        }
        prefs.edit().putBoolean("wake_on_home",enabled).apply();wakeFault=false;stopVoice();
        emit("state",state());scheduleWake();
    }
    private boolean agendaSpeaking;
    private static final String ORIGIN = "https://ultron.launcher.local/";
    private final Runnable refresh = new Runnable() {
        public void run() { if (visible && ready) { emit("state", state()); main.postDelayed(this, 15000); } }
    };
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        offline=new OfflineVoice(this,new OfflineVoice.Callback(){public void state(String phase){voiceState(phase);}public void text(String text){if(visible)command(text);}public void error(String text){wakeFault=true;if(visible)message(text);}
        public void wake(String text){if(!visible||homeCovered)return;if(text.isEmpty())voice();else command(text);}});
        prefs = getSharedPreferences("ultron_launcher_layout_v1", MODE_PRIVATE);
        personalAi = new PersonalAi(this);
        latestNews = new LatestNews();
        getWindow().setStatusBarColor(Color.BLACK);
        getWindow().setNavigationBarColor(Color.BLACK);
        getWindow().getDecorView().setSystemUiVisibility(0);
        root = new FrameLayout(this);root.setBackgroundColor(Color.BLACK);setContentView(root);
        try { web = new WebView(this); }
        catch (Throwable error) { new AlertDialog.Builder(this).setMessage("Il componente WebView di sistema non è disponibile.").setPositiveButton("Impostazioni", (d,w)->open(new Intent(Settings.ACTION_SETTINGS))).setNegativeButton("Chiudi",null).show();return; }
        root.addView(web,new FrameLayout.LayoutParams(-1,-1));web.setBackgroundColor(Color.BLACK);web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        if (Build.VERSION.SDK_INT >= 30) {
            getWindow().setDecorFitsSystemWindows(false);
            getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_NOTHING);
            root.setOnApplyWindowInsetsListener((view,insets)->{
                android.graphics.Insets bars=insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                android.graphics.Insets ime=insets.getInsets(WindowInsets.Type.ime());
                root.setPadding(bars.left,bars.top,bars.right,Math.max(bars.bottom,ime.bottom));
                return insets;
            });
        } else getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);
        WebSettings config=web.getSettings();config.setJavaScriptEnabled(true);config.setDomStorageEnabled(false);
        config.setAllowFileAccess(false);config.setAllowContentAccess(false);config.setJavaScriptCanOpenWindowsAutomatically(false);
        config.setSupportMultipleWindows(false);config.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        config.setCacheMode(WebSettings.LOAD_NO_CACHE);config.setTextZoom(100);
        web.addJavascriptInterface(new Bridge(),"UltronNative");
        web.setWebViewClient(new WebViewClient(){
            @Override public WebResourceResponse shouldInterceptRequest(WebView view,WebResourceRequest request) {
                Uri uri=request.getUrl();
                if (!"https".equals(uri.getScheme()) || !"ultron.launcher.local".equals(uri.getHost())) return blocked();
                String path=uri.getPath();
                if(path==null || path.contains("..") || path.contains("\\") || path.length()>200)return blocked();
                if(path.equals("/"))path="/index.html";
                String mime=path.endsWith(".html")?"text/html":path.endsWith(".js")?"application/javascript":path.endsWith(".css")?"text/css":path.endsWith(".ttf")?"font/ttf":path.endsWith(".png")?"image/png":path.endsWith(".webp")?"image/webp":"application/octet-stream";
                try { return new WebResourceResponse(mime,"UTF-8",getAssets().open("hud"+path)); }
                catch(IOException error){return blocked();}
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest request) { return true; }
            @Override public void onPageFinished(WebView view,String url) { if(url.equals(ORIGIN+"index.html")){ready=true;if(visible){main.removeCallbacks(refresh);main.post(refresh);if(getIntent().getBooleanExtra("openAgenda",false)){getIntent().removeExtra("openAgenda");planner();}}} }
        });
        web.loadUrl(ORIGIN+"index.html");
        offline.warm();
    }
    private WebResourceResponse blocked(){return new WebResourceResponse("text/plain","UTF-8",new ByteArrayInputStream(new byte[0]));}
    @Override protected void onResume(){super.onResume();visible=true;wakeFault=false;scheduleWake();if(web!=null){web.onResume();web.resumeTimers();}main.removeCallbacks(refresh);main.post(refresh);if(ready&&getIntent().getBooleanExtra("openAgenda",false)){getIntent().removeExtra("openAgenda");planner();}io.execute(()->{try{AgendaStore.reschedule(this);}catch(Exception ignored){}});}
    @Override protected void onPause(){visible=false;main.removeCallbacks(armWake);main.removeCallbacks(refresh);stopVoice();stopSpeaking();if(web!=null){web.onPause();web.pauseTimers();}super.onPause();}
    @Override protected void onNewIntent(Intent intent){super.onNewIntent(intent);setIntent(intent);if(visible&&ready&&intent.getBooleanExtra("openAgenda",false))planner();else if(web!=null&&ready)web.evaluateJavascript("window.UltronBack&&window.UltronBack()",null);}
    @Override public void onBackPressed(){if(web!=null&&ready)web.evaluateJavascript("window.UltronBack&&window.UltronBack()",null);}
    @Override protected void onDestroy(){visible=false;main.removeCallbacksAndMessages(null);stopVoice();if(offline!=null){offline.close();offline=null;}stopSpeaking();ttsInitToken++;if(tts!=null){tts.shutdown();tts=null;}io.shutdownNow();appsIo.shutdownNow();launchIo.shutdownNow();if(personalAi!=null)personalAi.close();if(latestNews!=null)latestNews.close();if(web!=null){web.removeJavascriptInterface("UltronNative");root.removeView(web);web.destroy();web=null;}super.onDestroy();}
    public final class Bridge {
        @JavascriptInterface public void action(String action,String payload){
            if(action==null||action.length()>30||payload==null||payload.length()>10000)return;
            final JSONObject data;try{data=new JSONObject(payload);}catch(JSONException e){return;}
            main.post(()->{if(visible&&!isDestroyed())handle(action,data);});
        }
    }
    private void emit(String type,Object data){
        main.post(()->{if(web==null||isDestroyed()||!ready||!visible)return;
            JSONArray args=new JSONArray();args.put(type);args.put(data);
            web.evaluateJavascript("window.UltronReceive&&window.UltronReceive.apply(null,"+args.toString()+")",null);
        });
    }
    private void message(String text){emit("toast",text);}
    private JSONObject state(){
        JSONObject data=new JSONObject();
        try {
            ActivityManager.MemoryInfo memory=new ActivityManager.MemoryInfo();((ActivityManager)getSystemService(ACTIVITY_SERVICE)).getMemoryInfo(memory);
            if(memory.totalMem>0)data.put("ram",Math.round(100.0*(memory.totalMem-memory.availMem)/memory.totalMem));
            StatFs disk=new StatFs(Environment.getDataDirectory().getAbsolutePath());if(disk.getTotalBytes()>0)data.put("disk",Math.round(100.0*(disk.getTotalBytes()-disk.getAvailableBytes())/disk.getTotalBytes()));
            BatteryManager battery=(BatteryManager)getSystemService(BATTERY_SERVICE);int level=battery.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY);if(level>=0&&level<=100)data.put("battery",level);
            data.put("wakeEnabled",prefs.getBoolean("wake_on_home",false));data.put("voicePhase",voicePhase);data.put("device",Build.MODEL.toUpperCase(Locale.ITALIAN));data.put("motion",prefs.getBoolean("hud_animations",true));
            String weather=prefs.getString("app_weather",null);
            if(weather!=null){try{data.put("weatherApp",getPackageManager().getApplicationLabel(getPackageManager().getApplicationInfo(weather,0)).toString());}catch(Exception ignored){}}
            AlarmManager.AlarmClockInfo next=((AlarmManager)getSystemService(ALARM_SERVICE)).getNextAlarmClock();
            data.put("alarm",next==null?"Nessuna sveglia visibile":"Sveglia "+new SimpleDateFormat("EEE HH:mm",Locale.ITALIAN).format(new Date(next.getTriggerTime())));
        } catch(Exception ignored){}
        return data;
    }
    private boolean open(Intent... intents){
        for(Intent intent:intents){try{startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));return true;}catch(ActivityNotFoundException|SecurityException ignored){}}
        message("Nessuna app disponibile per questa azione");return false;
    }
    private boolean selected(String slot){
        if(slot==null||!slot.matches("(?:dock[0134]|quick[123]|weather)"))return false;
        String pkg=prefs.getString("app_"+slot,null),activity=prefs.getString("activity_"+slot,null);if(pkg==null)return false;
        Intent intent=activity==null?getPackageManager().getLaunchIntentForPackage(pkg):new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER).setClassName(pkg,activity);
        if(intent==null)return false;
        try{startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));return true;}catch(ActivityNotFoundException|SecurityException ignored){return false;}
    }
    private void ultron(){
        if(selected("dock3"))return;
        for(String pkg:new String[]{"com.ultron.messenger.pilot","com.ultron.messenger"}){
            Intent intent=getPackageManager().getLaunchIntentForPackage(pkg);if(intent!=null){open(intent);return;}
        }emit("pick","dock3");
    }
    private void handle(String action,JSONObject data){
        switch(action){
            case "ready":emit("state",state());scheduleWake();break;
            case "contacts":open(new Intent(Intent.ACTION_VIEW,ContactsContract.Contacts.CONTENT_URI),new Intent(Intent.ACTION_DIAL));break;
            case "wakeMode":configureWake(data.optBoolean("enabled",false));break;
            case "panel":
                homeCovered=data.optBoolean("open",false);
                if(homeCovered)stopVoice();else scheduleWake();
                break;
            case "apps":listApps();break;
            case "choose":case "launch":launchChoice(data,action.equals("choose"));break;
            case "weather":if(!selected("weather"))emit("pick","weather");break;
            case "calls":if(!selected("dock0"))open(new Intent(Intent.ACTION_DIAL));break;
            case "sms":if(!selected("dock1"))open(new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_APP_MESSAGING),new Intent(Intent.ACTION_SENDTO,Uri.parse("smsto:")));break;
            case "ultron":ultron();break;
            case "browser":if(!selected("dock4"))browser("");break;
            case "search":browser(data.optString("query","").substring(0,Math.min(2048,data.optString("query","").length())));break;
            case "settings":open(new Intent(Settings.ACTION_SETTINGS));break;
            case "system":open(new Intent(Settings.ACTION_DEVICE_INFO_SETTINGS),new Intent(Settings.ACTION_SETTINGS));break;
            case "storage":open(new Intent(Settings.ACTION_INTERNAL_STORAGE_SETTINGS),new Intent(Settings.ACTION_SETTINGS));break;
            case "battery":open(new Intent(Settings.ACTION_BATTERY_SAVER_SETTINGS),new Intent(Settings.ACTION_SETTINGS));break;
            case "network":open(new Intent(Settings.Panel.ACTION_INTERNET_CONNECTIVITY),new Intent(Settings.ACTION_WIRELESS_SETTINGS));break;
            case "files":open(new Intent(Intent.ACTION_VIEW).setDataAndType(Uri.parse("content://com.android.externalstorage.documents/root/primary"),"vnd.android.document/root"),new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*"));break;
            case "alarms":open(new Intent(AlarmClock.ACTION_SHOW_ALARMS),new Intent(Intent.ACTION_MAIN).setClassName("com.android.deskclock","com.android.deskclock.DeskClock"));break;
            case "timer":open(new Intent(AlarmClock.ACTION_SET_TIMER));break;
            case "calendar":open(new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_APP_CALENDAR),new Intent(Intent.ACTION_VIEW,Uri.parse("content://com.android.calendar/time/"+System.currentTimeMillis())));break;
            case "appInfo":open(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,Uri.parse("package:"+getPackageName())));break;
            case "shortcut":String slot=data.optString("slot","");if(slot.matches("quick[123]")&&!selected(slot))emit("pick",slot);break;
            case "motion":prefs.edit().putBoolean("hud_animations",data.optBoolean("enabled",true)).apply();break;
            case "newsToday":readLatestNews();break;
            case "newsArticle":
                Uri article=Uri.parse(data.optString("url",""));
                if("https".equals(article.getScheme()) && "www.ansa.it".equals(article.getHost()) &&
                    article.getUserInfo()==null && article.getPort()==-1)
                    open(new Intent(Intent.ACTION_VIEW,article).addCategory(Intent.CATEGORY_BROWSABLE));
                break;
            case "macConfig":configureMacLink();break;
            case "macPage":openMacPage(data.optString("page",""));break;
            case "aiList":emitAiList();break;
            case "aiEdit":editPersonalAi(data.optString("id",""));break;
            case "aiDelete":deletePersonalAi(data.optString("id",""));break;
            case "aiTest":if(personalAi!=null)personalAi.testAll((type,value)->emit(type,value));break;
            case "aiAsk":if(personalAi!=null)personalAi.ask(data.optString("question",""),(type,value)->emit(type,value));break;
            case "voice":voice();break;
            case "voiceSetup":voiceSetup();break;
            case "voiceConfigure":configureVoice(data.optString("pkg",""));break;
            case "voiceTest":ttsInitToken++;ttsInitializing=false;ttsReady=false;if(tts!=null){tts.shutdown();tts=null;}say("Sono UNVOR. Questa è una prova della voce italiana sul Pixel.");break;
            case "voiceSettings":open(new Intent("com.android.settings.TTS_SETTINGS"),new Intent(Settings.ACTION_SETTINGS));break;
            case "stopVoice":stopVoice();stopSpeaking();break;
            case "agenda":localAgenda();break;
            case "externalAgenda":agendaSpeaking=false;agenda();break;
            case "command":stopVoice();stopSpeaking();command(data.optString("text","").substring(0,Math.min(500,data.optString("text","").length())));break;
            case "planner":planner();break;
            case "saveEvent":saveEvent(data);break;
            case "deleteEvent":deleteEvent(data.optString("id",""));break;
            case "reminderPermissions":reminderPermissions();break;
            case "stopAlarm":stopService(new Intent(this,AgendaAlarmService.class));break;
            case "callChoice":String token=data.optString("token","");String number=callChoices.remove(token);if(number!=null&&System.currentTimeMillis()<choicesExpire){callChoices.clear();call(number);}else message("Scelta scaduta: ripeti il comando chiamata.");break;
            case "profile":profile();break;
            default:message("Comando non disponibile");
        }
    }
    private void browser(String query){open(new Intent(Intent.ACTION_VIEW,Uri.parse(query.trim().isEmpty()?"https://duckduckgo.com/":"https://duckduckgo.com/?q="+Uri.encode(query.trim()))));}
    private List<ResolveInfo> launchable(){List<ResolveInfo> all=getPackageManager().queryIntentActivities(new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER),0);List<ResolveInfo> result=new ArrayList<>();for(ResolveInfo row:all)if(!row.activityInfo.packageName.equals(getPackageName())&&row.activityInfo.exported)result.add(row);Collections.sort(result,(a,b)->Collator.getInstance(Locale.ITALIAN).compare(a.loadLabel(getPackageManager()).toString(),b.loadLabel(getPackageManager()).toString()));return result;}
    private static String launchTarget(String pkg,String activity){return pkg+"\n"+activity;}
    private void listApps(){
        JSONArray cached=cachedApps;
        if(cached!=null && android.os.SystemClock.elapsedRealtime()-cachedAppsAt<APP_CACHE_MS){emit("apps",cached);return;}
        appsIo.execute(()->{
            JSONArray quickRows=new JSONArray();
            JSONArray iconRows=new JSONArray();
            List<ResolveInfo> installed=launchable();
            Set<String> targets=new HashSet<>();
            for(ResolveInfo app:installed){try{
                targets.add(launchTarget(app.activityInfo.packageName,app.activityInfo.name));
                JSONObject row=new JSONObject();
                row.put("label",app.loadLabel(getPackageManager()).toString());
                row.put("pkg",app.activityInfo.packageName);
                row.put("activity",app.activityInfo.name);
                quickRows.put(row);
            }catch(Exception ignored){}}
            // Make the entire app menu clickable before encoding a single icon.
            knownLaunchTargets=Collections.unmodifiableSet(targets);
            cachedApps=quickRows;
            cachedAppsAt=android.os.SystemClock.elapsedRealtime();
            emit("apps",quickRows);
            for(ResolveInfo app:installed){try{
                JSONObject row=new JSONObject();
                row.put("label",app.loadLabel(getPackageManager()).toString());
                row.put("pkg",app.activityInfo.packageName);
                row.put("activity",app.activityInfo.name);
                // A broken icon must not remove an otherwise launchable app.
                try {
                    Drawable icon=app.loadIcon(getPackageManager());
                    Bitmap bitmap=Bitmap.createBitmap(72,72,Bitmap.Config.ARGB_8888);
                    Canvas canvas=new Canvas(bitmap);icon.setBounds(0,0,72,72);icon.draw(canvas);
                    ByteArrayOutputStream bytes=new ByteArrayOutputStream();
                    bitmap.compress(Bitmap.CompressFormat.PNG,100,bytes);bitmap.recycle();
                    row.put("icon",Base64.encodeToString(bytes.toByteArray(),Base64.NO_WRAP));
                } catch(Exception ignored){}
                iconRows.put(row);
            }catch(Exception ignored){}}
            cachedApps=iconRows;
            cachedAppsAt=android.os.SystemClock.elapsedRealtime();
            emit("apps",iconRows);
        });
    }
    private void launchVerified(String pkg,String activity,String slot,boolean choose){
        if(!visible||isDestroyed())return;
        if(choose){
            prefs.edit().putString("app_"+slot,pkg).putString("activity_"+slot,activity).apply();
            emit("state",state());message("Collegamento salvato");
        }else{
            open(new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER).setClassName(pkg,activity));
        }
    }
    private void launchChoice(JSONObject data,boolean choose){
        String pkg=data.optString("pkg",""),activity=data.optString("activity",""),slot=data.optString("slot","");
        if(choose&&!slot.matches("(?:dock[0134]|quick[123]|weather)")){message("Collegamento non valido");return;}
        // Only explicitly exported, system-discovered launcher activities are allowed.
        if(pkg.isEmpty()||activity.isEmpty()||pkg.length()>200||activity.length()>240){message("App non valida");return;}
        if(knownLaunchTargets.contains(launchTarget(pkg,activity))){
            // Instant path: no package-manager query and no slow icon worker.
            launchVerified(pkg,activity,slot,choose);
            return;
        }
        // Cold first tap / expired discovery: independently validate without
        // waiting for the list-apps worker or the agenda / profile worker.
        launchIo.execute(()->{
            boolean valid=false;
            for(ResolveInfo row:launchable())
                if(row.activityInfo.packageName.equals(pkg)&&row.activityInfo.name.equals(activity)){valid=true;break;}
            final boolean found=valid;
            main.post(()->{
                if(!visible||isDestroyed())return;
                if(!found){message("Questa app non è più disponibile");return;}
                launchVerified(pkg,activity,slot,choose);
            });
        });
    }


    private void readLatestNews(){
        if(latestNews==null){message("Lettore notizie non disponibile.");return;}
        emit("newsBusy","Carico i titoli di oggi dal feed ANSA…");
        latestNews.readToday(data->{
            if(!visible)return;
            emit("newsToday",data);
            String notice=data.optString("notice","");
            JSONArray items=data.optJSONArray("items");
            if(!data.optBoolean("ok",false)||items==null||items.length()==0){
                if(!notice.isEmpty())say(notice);
                return;
            }
            StringBuilder spoken=new StringBuilder("Notizie verificate di oggi, fonte ANSA. ");
            int limit=Math.min(3,items.length());
            for(int i=0;i<limit;i++){
                JSONObject row=items.optJSONObject(i);
                if(row!=null)spoken.append("Notizia ").append(i+1).append(". ")
                    .append(row.optString("title","")).append(". ");
            }
            say(spoken.toString());
        });
    }
    private void configureMacLink(){
        final EditText url=new EditText(this);
        url.setSingleLine(true);
        url.setHint("https://nome-mac-o-gateway-sicuro");
        url.setInputType(android.text.InputType.TYPE_CLASS_TEXT|
            android.text.InputType.TYPE_TEXT_VARIATION_URI);
        url.setText(prefs.getString("mac_hub_https",""));
        int h=(int)(20*getResources().getDisplayMetrics().density);
        LinearLayout layout=new LinearLayout(this);
        layout.setOrientation(LinearLayout.VERTICAL);
        layout.setPadding(h,h,h,h);
        TextView warning=new TextView(this);
        warning.setText("Il Mac deve essere raggiungibile dal telefono tramite HTTPS verificato. "
            +"127.0.0.1 è il telefono stesso, non il Mac. "
            +"Questi link aprono pagine nel browser, non sincronizzano dati o addestrano modelli.");
        layout.addView(warning);
        layout.addView(url);
        AlertDialog dialog=new AlertDialog.Builder(this).setTitle("Collega le pagine UNVOR sul Mac")
            .setView(layout).setNegativeButton("Annulla",null)
            .setPositiveButton("Salva",null).create();
        dialog.setOnShowListener(ignored->dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v->{
            String input=url.getText().toString().trim();
            if(input.isEmpty()){
                prefs.edit().remove("mac_hub_https").apply();
                message("Collegamento Mac rimosso.");dialog.dismiss();return;
            }
            try{
                java.net.URI parsed=new java.net.URI(input);
                if(!"https".equalsIgnoreCase(parsed.getScheme())||
                    parsed.getHost()==null||parsed.getUserInfo()!=null||
                    parsed.getQuery()!=null||parsed.getFragment()!=null||
                    (parsed.getPath()!=null && !parsed.getPath().isEmpty() && !"/".equals(parsed.getPath()))||
                    parsed.getPort()>65535 || input.length()>300)
                    throw new IllegalArgumentException("Serve un indirizzo HTTPS del Mac/gateway, senza percorsi né parametri.");
                String clean=parsed.getScheme()+"://"+parsed.getRawAuthority();
                prefs.edit().putString("mac_hub_https",clean).apply();
                message("Collegamento salvato: prova Notizie o Universo.");
                dialog.dismiss();
            }catch(Exception error){
                url.setError("Inserisci un URL HTTPS valido e raggiungibile dal telefono.");
            }
        }));
        dialog.show();
    }
    private void openMacPage(String page){
        if(!"notizie".equals(page)&&!"universo".equals(page))return;
        String base=prefs.getString("mac_hub_https","");
        if(base.isEmpty()){
            message("Configura l'indirizzo HTTPS del Mac in Impostazioni UNVOR → Pagine Mac.");
            configureMacLink();
            return;
        }
        open(new Intent(Intent.ACTION_VIEW,Uri.parse(base+"/ui/#"+page))
            .addCategory(Intent.CATEGORY_BROWSABLE));
    }

    private void emitAiList(){
        try {emit("aiList",personalAi.list());}
        catch(Exception error){message("Impossibile leggere le configurazioni AI.");}
    }
    private void deletePersonalAi(String id){
        if(personalAi==null)return;
        new AlertDialog.Builder(this)
            .setTitle("Rimuovere le credenziali AI?")
            .setMessage("La chiave di questo provider verrà eliminata da questo telefono. Gli altri utenti e dispositivi non cambiano.")
            .setNegativeButton("Annulla",null)
            .setPositiveButton("Rimuovi",(dialog,which)->{
                try{emit("aiList",personalAi.delete(id));}
                catch(Exception error){message("Impossibile rimuovere questa configurazione.");}
            }).show();
    }
    private void editPersonalAi(String id){
        if(personalAi==null)return;
        JSONObject row=null;
        try{
            JSONArray rows=personalAi.list().getJSONArray("rows");
            for(int i=0;i<rows.length();i++){
                JSONObject current=rows.getJSONObject(i);
                if(id.equals(current.optString("id"))){row=current;break;}
            }
        }catch(Exception ignored){}
        if(row==null){message("Provider non riconosciuto");return;}
        if(!row.optBoolean("available")){message("Questo servizio non offre più l'API utilizzata.");return;}
        final JSONObject current=row;
        LinearLayout fields=new LinearLayout(this);
        fields.setOrientation(LinearLayout.VERTICAL);
        fields.setPadding(44,24,44,16);
        fields.setBackgroundColor(Color.rgb(3,16,27));
        final EditText apiKey=new EditText(this);
        apiKey.setSingleLine(true);
        apiKey.setTextColor(Color.WHITE);
        apiKey.setHintTextColor(Color.LTGRAY);
        apiKey.setHint(current.optBoolean("configured") ? "Chiave salvata · lascia vuoto per conservarla" : "La tua chiave API");
        apiKey.setInputType(android.text.InputType.TYPE_CLASS_TEXT|android.text.InputType.TYPE_TEXT_VARIATION_PASSWORD);
        if(!"ollama".equals(id))fields.addView(apiKey,new LinearLayout.LayoutParams(-1,-2));
        final EditText model=new EditText(this);
        model.setSingleLine(true);
        model.setText(current.optString("model",""));
        model.setTextColor(Color.WHITE);model.setHintTextColor(Color.LTGRAY);model.setHint("Modello AI");
        fields.addView(model,new LinearLayout.LayoutParams(-1,-2));
        final EditText endpoint=new EditText(this);
        endpoint.setSingleLine(true);
        endpoint.setText(current.optString("endpoint",""));
        endpoint.setTextColor(Color.WHITE);endpoint.setHintTextColor(Color.LTGRAY);
        endpoint.setHint("Endpoint HTTPS protetto");
        endpoint.setInputType(android.text.InputType.TYPE_CLASS_TEXT|android.text.InputType.TYPE_TEXT_VARIATION_URI);
        if(current.optBoolean("requiresEndpoint"))fields.addView(endpoint,new LinearLayout.LayoutParams(-1,-2));
        final EditText account=new EditText(this);
        account.setSingleLine(true);
        account.setText(current.optString("accountId",""));
        account.setTextColor(Color.WHITE);account.setHintTextColor(Color.LTGRAY);account.setHint("Cloudflare Account ID");
        if(current.optBoolean("requiresAccount"))fields.addView(account,new LinearLayout.LayoutParams(-1,-2));
        TextView priorityLabel=new TextView(this);
        priorityLabel.setTextColor(Color.rgb(108,230,255));
        priorityLabel.setText("Priorità: 1, 2, 3 = attiva. 0 = riserva");
        fields.addView(priorityLabel,new LinearLayout.LayoutParams(-1,-2));
        final EditText priority=new EditText(this);
        priority.setSingleLine(true);
        priority.setInputType(android.text.InputType.TYPE_CLASS_NUMBER);
        priority.setText(String.valueOf(current.optInt("priority",0)));
        priority.setTextColor(Color.WHITE);
        fields.addView(priority,new LinearLayout.LayoutParams(-1,-2));
        TextView privacy=new TextView(this);
        privacy.setTextColor(Color.LTGRAY);
        privacy.setText("La chiave viene cifrata con Android Keystore e resta su questo dispositivo. Le domande vengono inviate solo al provider scelto. Il test usa una richiesta reale e può consumare quota.");
        privacy.setTextSize(12f);fields.addView(privacy,new LinearLayout.LayoutParams(-1,-2));
        ScrollView scroll=new ScrollView(this);
        scroll.addView(fields);
        AlertDialog dialog=new AlertDialog.Builder(this)
            .setTitle("UNVOR AI · "+current.optString("name",id))
            .setView(scroll)
            .setNegativeButton("Annulla",null)
            .setPositiveButton("Salva",null).create();
        dialog.setOnShowListener(ignored->dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(button->{
            try{
                int order=Integer.parseInt(priority.getText().toString().trim());
                JSONObject state=personalAi.save(id,apiKey.getText().toString(),
                    model.getText().toString(),endpoint.getText().toString(),order,order>0,
                    account.getText().toString());
                apiKey.getText().clear();
                emit("aiList",state);
                dialog.dismiss();
            }catch(Exception error){
                String reason=error.getMessage()==null?"Configurazione non valida":error.getMessage();
                new AlertDialog.Builder(this).setTitle("Controlla i dati").setMessage(reason)
                    .setPositiveButton("OK",null).show();
            }
        }));
        dialog.show();
    }

    private void profile(){io.execute(()->{JSONObject result=new JSONObject();try(Cursor cursor=getContentResolver().query(Uri.parse("content://com.ultron.messenger.pilot.launcherprofile/current"),null,null,null,null)){
        if(cursor!=null&&cursor.moveToFirst()){int col=cursor.getColumnIndex("lns");if(col>=0)result.put("lns",cursor.getString(col));}
    }catch(Exception ignored){}emit("profile",result);});}
    private void voiceState(String phase){voicePhase=phase;emit("voice",phase);if("idle".equals(phase))scheduleWake();}
    private void stopSpeaking(){speechGeneration++;queuedSpeech=null;if(tts!=null)tts.stop();voiceState("idle");}
    private List<String> voiceEngines(){
        List<String> result=new ArrayList<>();
        for(ResolveInfo info:getPackageManager().queryIntentServices(new Intent("android.intent.action.TTS_SERVICE"),0))if(info.serviceInfo!=null&&!info.serviceInfo.packageName.startsWith("com.google.")&&!result.contains(info.serviceInfo.packageName))result.add(info.serviceInfo.packageName);
        String preferred=Settings.Secure.getString(getContentResolver(),"tts_default_synth");
        return VoiceSelection.engines(result,preferred);
    }
    private void voiceSetup(){JSONArray rows=new JSONArray();for(String pkg:voiceEngines()){JSONObject row=new JSONObject();try{row.put("pkg",pkg).put("label",getPackageManager().getApplicationLabel(getPackageManager().getApplicationInfo(pkg,0)).toString());rows.put(row);}catch(Exception ignored){}}emit("voiceEngines",rows);}
    private void configureVoice(String pkg){if(!voiceEngines().contains(pkg)){message("Motore non disponibile");return;}Intent launch=getPackageManager().getLaunchIntentForPackage(pkg);if(launch!=null){open(launch);return;}open(new Intent(TextToSpeech.Engine.ACTION_INSTALL_TTS_DATA).setPackage(pkg),new Intent("com.android.settings.TTS_SETTINGS"),new Intent(Settings.ACTION_SETTINGS));}
    private void say(String text){
        if(!visible)return;
        if(offline!=null)offline.stop();
        emit("answer",text);queuedSpeech=text;queuedSpeechGeneration=++speechGeneration;
        if(ttsReady&&tts!=null){speakQueued();return;}
        if(ttsInitializing)return;
        ttsInitializing=true;initVoice(voiceEngines(),0,++ttsInitToken);
    }
    private void initVoice(List<String> engines,int index,int token){
        if(isDestroyed()||token!=ttsInitToken)return;
        if(index>=engines.size()){ttsInitializing=false;ttsReady=false;tts=null;queuedSpeech=null;voiceState("idle");message("Nessuna voce italiana offline pronta. Apri Strumenti → Voce italiana offline per configurarla.");return;}
        String engine=engines.get(index);final TextToSpeech[] holder=new TextToSpeech[1];
        holder[0]=new TextToSpeech(this,status->main.post(()->{
            TextToSpeech candidate=holder[0];
            if(token!=ttsInitToken||isDestroyed()||tts!=candidate){if(candidate!=null)candidate.shutdown();return;}
            Voice chosen=null;
            if(status==TextToSpeech.SUCCESS){try{candidate.setLanguage(Locale.ITALIAN);Set<Voice> voices=candidate.getVoices();if(voices!=null)for(Voice v:voices)if(!v.isNetworkConnectionRequired()&&VoiceSelection.italian(v.getLocale())){chosen=v;break;}}catch(Exception ignored){}}
            if(chosen==null||candidate.setVoice(chosen)!=TextToSpeech.SUCCESS){candidate.shutdown();tts=null;main.post(()->initVoice(engines,index+1,token));return;}
            ttsReady=true;ttsInitializing=false;
            candidate.setOnUtteranceProgressListener(new UtteranceProgressListener(){
                public void onStart(String id){main.post(()->{if(id.equals("ultron-"+speechGeneration)&&visible)voiceState("speaking");});}
                public void onRangeStart(String id,int start,int end,int frame){
                    main.post(()->{if(visible && id.equals("ultron-"+speechGeneration) && "speaking".equals(voicePhase))emit("voiceBeat",1);});
                }
                public void onDone(String id){main.post(()->{if(id.equals("ultron-"+speechGeneration))voiceState("idle");});}
                public void onError(String id){main.post(()->{if(id.equals("ultron-"+speechGeneration)){voiceState("idle");message("Lettura vocale non riuscita. La risposta è disponibile per iscritto.");}});}
            });
            if(visible&&queuedSpeech!=null&&queuedSpeechGeneration==speechGeneration)speakQueued();
        }),engine);
        tts=holder[0];
        main.postDelayed(()->{if(token==ttsInitToken&&ttsInitializing&&tts==holder[0]){holder[0].shutdown();tts=null;initVoice(engines,index+1,token);}},8000);
    }
    private void speakQueued(){if(tts==null||!ttsReady||queuedSpeech==null||!visible||queuedSpeechGeneration!=speechGeneration)return;String text=queuedSpeech;queuedSpeech=null;voiceState("processing");if(tts.speak(text,TextToSpeech.QUEUE_FLUSH,null,"ultron-"+speechGeneration)!=TextToSpeech.SUCCESS){voiceState("idle");message("Il motore vocale non ha accettato la lettura.");}}
    private void stopVoice(){if(offline!=null)offline.stop();voiceState("idle");}
    private void voice(){
        if(checkSelfPermission(Manifest.permission.RECORD_AUDIO)!=PackageManager.PERMISSION_GRANTED){pendingPermission="voice";requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO},41);return;}
        stopSpeaking();if(offline!=null)offline.start();
    }
    private void command(String heard){LocalCommands command=LocalCommands.parse(heard);
        if(command.type.equals("call")){callContact(command.text);return;}
        if(command.type.equals("alarm")){open(new Intent(AlarmClock.ACTION_SET_ALARM).putExtra(AlarmClock.EXTRA_HOUR,command.hour).putExtra(AlarmClock.EXTRA_MINUTES,command.minute).putExtra(AlarmClock.EXTRA_MESSAGE,"UNVOR").putExtra(AlarmClock.EXTRA_SKIP_UI,true));return;}
        if(command.type.equals("invalidTime")){say("Orario non valido. Puoi dire: metti la sveglia alle sei e trenta.");return;}
        if(command.type.equals("planner")||command.type.equals("shifts")){planner();return;}
        if(command.type.equals("newEvent")){emit("newEvent",command.text);return;}
        if(command.type.equals("summary")){localAgenda();return;}
        if(command.type.equals("time")){say("Sono le "+new SimpleDateFormat("HH:mm",Locale.ITALIAN).format(new Date()));return;}
        if(command.type.equals("news")){readLatestNews();return;}
        if(command.type.equals("universe")){openMacPage("universo");return;}
        if(command.type.equals("open")){final String name=command.text;io.execute(()->{ResolveInfo best=null;for(ResolveInfo app:launchable()){String label=LocalCommands.normalize(app.loadLabel(getPackageManager()).toString());if(label.equals(name)){best=app;break;}if(best==null&&label.contains(name))best=app;}final ResolveInfo app=best;main.post(()->{if(!visible)return;if(app==null)message("App non trovata");else open(new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER).setClassName(app.activityInfo.packageName,app.activityInfo.name));});});return;}
        try {
            if(personalAi!=null && personalAi.list().optInt("active",0)>0){
                personalAi.ask(heard,(type,value)->{
                    emit(type,value);
                    if("aiAnswer".equals(type)){
                        String answer=value instanceof JSONObject?((JSONObject)value).optString("text",""):String.valueOf(value);
                        if(visible && !answer.isEmpty())say(answer);
                    }
                });
                return;
            }
        }catch(Exception ignored){}
        say("Puoi chiedere: chiama mamma, metti la sveglia alle sei, agenda di oggi, apri agenda, oppure apri seguito dal nome di un’app. Per le domande generiche, configura AI personali nelle impostazioni.");
    }
    private void callContact(String name){pendingContactName=name;if(checkSelfPermission(Manifest.permission.READ_CONTACTS)!=PackageManager.PERMISSION_GRANTED){pendingPermission="contacts";requestPermissions(new String[]{Manifest.permission.READ_CONTACTS},43);return;}
        io.execute(()->{List<String[]> matches=new ArrayList<>();try(Cursor c=getContentResolver().query(Uri.withAppendedPath(ContactsContract.CommonDataKinds.Phone.CONTENT_FILTER_URI,Uri.encode(name)),new String[]{ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME,ContactsContract.CommonDataKinds.Phone.NUMBER},null,null,null)){
            Set<String> seen=new HashSet<>();if(c!=null)while(c.moveToNext()&&matches.size()<20){String label=c.getString(0),number=c.getString(1);if(number!=null&&seen.add(number))matches.add(new String[]{label,number});}
        }catch(Exception e){main.post(()->message("Rubrica non disponibile"));return;}
        List<String[]> exact=new ArrayList<>();for(String[] row:matches)if(LocalCommands.normalize(row[0]).equals(name))exact.add(row);final List<String[]> options=exact.isEmpty()?matches:exact;
        main.post(()->{if(!visible)return;if(options.isEmpty()){say("Non trovo "+name+" nella rubrica del telefono.");return;}if(options.size()==1){call(options.get(0)[1]);return;}JSONArray rows=new JSONArray();callChoices.clear();choicesExpire=System.currentTimeMillis()+60000;for(String[] item:options){String token=UUID.randomUUID().toString();callChoices.put(token,item[1]);JSONObject row=new JSONObject();try{row.put("label",item[0]+" · "+item[1]).put("token",token);rows.put(row);}catch(Exception ignored){}}emit("callChoices",rows);});
        });
    }
    private void call(String number){if(number==null||!number.matches("[+0-9 ()\\.\\-]{3,40}")){message("Il contatto non contiene un numero telefonico valido.");return;}if(checkSelfPermission(Manifest.permission.CALL_PHONE)!=PackageManager.PERMISSION_GRANTED){pendingPhone=number;pendingPermission="call";requestPermissions(new String[]{Manifest.permission.CALL_PHONE},44);return;}pendingPhone=null;open(new Intent(Intent.ACTION_CALL,Uri.fromParts("tel",number,null)));}
    private void planner(){io.execute(()->{try{JSONObject data=new JSONObject();data.put("rows",AgendaStore.list(this)).put("exact",AgendaStore.exact(this)).put("notifications",AgendaStore.notifications(this));emit("planner",data);}catch(Exception e){message("Agenda non leggibile. I dati esistenti non sono stati sovrascritti.");}});}
    private void saveEvent(JSONObject data){io.execute(()->{try{AgendaStore.save(this,data);emit("eventSaved",true);planner();}catch(Exception e){emit("eventError",e instanceof IllegalArgumentException?e.getMessage():"Salvataggio non riuscito: controlla i dati e lo spazio disponibile.");}});}
    private void deleteEvent(String id){io.execute(()->{try{AgendaStore.delete(this,id);emit("eventSaved",true);planner();}catch(Exception e){emit("eventError","Eliminazione non riuscita.");}});}
    private void reminderPermissions(){if(Build.VERSION.SDK_INT>=33&&checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED){pendingPermission="reminders";requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS},45);return;}if(Build.VERSION.SDK_INT>=31&&!AgendaStore.exact(this)){open(new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM,Uri.parse("package:"+getPackageName())));return;}open(new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE,getPackageName()));}
    private void localAgenda(){io.execute(()->{try{JSONArray rows=AgendaStore.list(this);java.time.LocalDate today=java.time.LocalDate.now();long a=today.atStartOfDay(java.time.ZoneId.systemDefault()).toInstant().toEpochMilli(),b=today.plusDays(1).atStartOfDay(java.time.ZoneId.systemDefault()).toInstant().toEpochMilli();List<JSONObject> sorted=new ArrayList<>();for(int i=0;i<rows.length();i++){JSONObject row=rows.getJSONObject(i);if(row.getLong("startMs")<b&&row.getLong("endMs")>a)sorted.add(row);}Collections.sort(sorted,(x,y)->Long.compare(x.optLong("startMs"),y.optLong("startMs")));StringBuilder out=new StringBuilder();for(JSONObject row:sorted)out.append(row.optString("start")).append(" ").append(row.optString("title")).append(". ");final String answer=out.length()==0?"Nessun impegno salvato nell’agenda UNVOR di oggi.":out.toString();main.post(()->say(answer));}catch(Exception e){message("Agenda non disponibile");}});}
    private void agenda(){if(checkSelfPermission(Manifest.permission.READ_CALENDAR)!=PackageManager.PERMISSION_GRANTED){pendingPermission="agenda";requestPermissions(new String[]{Manifest.permission.READ_CALENDAR},42);return;}
        io.execute(()->{Calendar start=Calendar.getInstance();start.set(Calendar.HOUR_OF_DAY,0);start.set(Calendar.MINUTE,0);start.set(Calendar.SECOND,0);start.set(Calendar.MILLISECOND,0);Calendar end=(Calendar)start.clone();end.add(Calendar.DAY_OF_MONTH,1);
            Uri.Builder uri=CalendarContract.Instances.CONTENT_URI.buildUpon();ContentUris.appendId(uri,start.getTimeInMillis());ContentUris.appendId(uri,end.getTimeInMillis());StringBuilder text=new StringBuilder();
            try(Cursor cursor=getContentResolver().query(uri.build(),new String[]{CalendarContract.Instances.TITLE,CalendarContract.Instances.BEGIN},null,null,CalendarContract.Instances.BEGIN+" ASC")){int count=0;if(cursor!=null)while(cursor.moveToNext()&&count++<20){text.append(new SimpleDateFormat("HH:mm",Locale.ITALIAN).format(new Date(cursor.getLong(1)))).append("  ").append(cursor.getString(0)).append('\n');}final String answer=text.length()==0?"Nessun impegno nel calendario di oggi.":text.toString();main.post(()->{if(!visible)return;if(agendaSpeaking)say(answer);else emit("agenda",answer);});}
            catch(Exception error){message("Calendario non disponibile");}
        });
    }
    @Override public void onRequestPermissionsResult(int request,String[] permissions,int[] results){super.onRequestPermissionsResult(request,permissions,results);String action=pendingPermission;pendingPermission=null;if(results.length==0||results[0]!=PackageManager.PERMISSION_GRANTED){message("Permesso non concesso");return;}if("wake".equals(action))configureWake(true);else if("voice".equals(action))voice();else if("agenda".equals(action))agenda();else if("contacts".equals(action)&&pendingContactName!=null)callContact(pendingContactName);else if("call".equals(action)&&pendingPhone!=null)call(pendingPhone);else if("reminders".equals(action))reminderPermissions();}
}
