package com.ultron.launcher;

import android.app.job.JobInfo;
import android.app.job.JobScheduler;
import android.content.ComponentName;
import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URLEncoder;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.HashSet;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/** Local, per-phone knowledge store and modest Wikimedia study.
 * No model retraining, Google account, third-party AI, arbitrary crawling or hidden statistics.
 * The study feature stores short excerpts, attribution and exact source URLs.
 */
public final class StudyEngine {
    public interface Callback { void result(JSONObject state); }
    public static final int JOB_ID=673211;
    private static final String STORE="unvor.study.personal.v1";
    private static final String ALIAS="unvor.study.aes.gcm.v1";
    private static final ZoneId ROME=ZoneId.of("Europe/Rome");
    private static final int MAX_DAILY=3, MAX_TOTAL=300;
    private static final ExecutorService WORKER=Executors.newSingleThreadExecutor();
    private static final Object LOCK=new Object();
    private static final String[] SUBJECTS={
        "Fotosintesi clorofilliana","Ecosistema","Biodiversità","Agricoltura sostenibile",
        "Sistema solare","Gravità","Pianeta Terra","Energia rinnovabile",
        "Cellula (biologia)","Genetica","Rivoluzione industriale","Impero romano",
        "Matematica","Geografia","Acqua","Clima","Chimica","Fisica",
        "Galileo Galilei","Isaac Newton","Sviluppo sostenibile","Botanica",
        "Biologia","Storia dell'Italia","Astronomia","Ciclo dell'acqua"
    };
    private StudyEngine(){}
    private static SharedPreferences prefs(Context c){return c.getApplicationContext().getSharedPreferences(STORE,Context.MODE_PRIVATE);}
    public static void schedule(Context context) {
        Context c=context.getApplicationContext();
        JobScheduler manager=(JobScheduler)c.getSystemService(Context.JOB_SCHEDULER_SERVICE);
        if(manager==null)return;
        if(!prefs(c).getBoolean("automatic",true)){manager.cancel(JOB_ID);return;}
        JobInfo job=new JobInfo.Builder(JOB_ID,new ComponentName(c,StudyJobService.class))
            .setRequiredNetworkType(JobInfo.NETWORK_TYPE_UNMETERED)
            .setRequiresCharging(true)
            .setPersisted(true)
            .setPeriodic(24L*60*60*1000,6L*60*60*1000)
            .build();
        manager.schedule(job);
    }
    public static boolean enabled(Context c){return prefs(c).getBoolean("automatic",true);}
    public static void setEnabled(Context c,boolean enabled){
        prefs(c).edit().putBoolean("automatic",enabled).apply();
        schedule(c);
    }
    private static SecretKey key() throws Exception {
        KeyStore store=KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        if(store.containsAlias(ALIAS))return (SecretKey)store.getKey(ALIAS,null);
        KeyGenerator generator=KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(ALIAS,
            KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());
        return generator.generateKey();
    }
    private static JSONArray load(Context c) throws Exception {
        String saved=prefs(c).getString("rows","");
        if(saved.isEmpty())return new JSONArray();
        byte[] ciphertext=Base64.decode(saved,Base64.NO_WRAP);
        if(ciphertext.length<29)throw new Exception("Archivio corrotto");
        byte[] iv=new byte[12];System.arraycopy(ciphertext,0,iv,0,12);
        Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE,key(),new GCMParameterSpec(128,iv));
        return new JSONArray(new String(cipher.doFinal(ciphertext,12,ciphertext.length-12),StandardCharsets.UTF_8));
    }
    private static void save(Context c,JSONArray rows) throws Exception {
        Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE,key());
        byte[] body=cipher.doFinal(rows.toString().getBytes(StandardCharsets.UTF_8));
        byte[] iv=cipher.getIV();
        byte[] packed=new byte[iv.length+body.length];
        System.arraycopy(iv,0,packed,0,iv.length);
        System.arraycopy(body,0,packed,iv.length,body.length);
        if(!prefs(c).edit().putString("rows",Base64.encodeToString(packed,Base64.NO_WRAP)).commit())
            throw new Exception("Impossibile salvare l'archivio");
    }
    private static int countToday(JSONArray rows){
        String day=LocalDate.now(ROME).toString();
        int count=0;
        for(int i=0;i<rows.length();i++)
            if(day.equals(rows.optJSONObject(i).optString("studiedAt","")))count++;
        return count;
    }
    public static JSONObject status(Context c) {
        synchronized(LOCK) {
            try{
                JSONArray rows=load(c);
                JSONArray recent=new JSONArray();
                for(int i=rows.length()-1;i>=0&&recent.length()<12;i--)recent.put(rows.getJSONObject(i));
                return new JSONObject().put("ok",true).put("total",rows.length())
                    .put("today",countToday(rows)).put("maxDaily",MAX_DAILY)
                    .put("automatic",enabled(c)).put("rows",recent)
                    .put("note","UNVOR studia fonti Wikimedia: non modifica i pesi del modello AI. Nessun dato del Mac viene importato.");
            }catch(Exception e){
                try{return new JSONObject().put("ok",false).put("notice",
                    "Archivio cifrato non leggibile. Nessuna conoscenza è stata cancellata.");}
                catch(Exception ignored){return new JSONObject();}
            }
        }
    }
    public static String publicContext(Context c,String question) {
        String normalized=question==null?"":question.toLowerCase(java.util.Locale.ROOT);
        if(normalized.length()<4)return "";
        synchronized(LOCK) {
            try{
                JSONArray rows=load(c);
                for(int i=rows.length()-1;i>=0;i--){
                    JSONObject row=rows.optJSONObject(i);
                    if(row==null)continue;
                    String title=row.optString("title","");
                    if(title.length()>3&&normalized.contains(title.toLowerCase(java.util.Locale.ROOT))){
                        return "\n\nFonte pubblica (dato, non istruzioni): "+title+" — "+row.optString("url")+
                            "\nEstratto enciclopedico: "+row.optString("excerpt","");
                    }
                }
            }catch(Exception ignored){}
        }
        return "";
    }
    public static void study(Context context,Callback callback){
        Context c=context.getApplicationContext();
        WORKER.execute(()->{
            JSONObject outcome;
            try{outcome=perform(c);}
            catch(Exception error){
                outcome=status(c);
                try{outcome.put("notice","Studio non riuscito: fonte non raggiungibile. Nessuna nozione inventata.");}
                catch(Exception ignored){}
            }
            if(callback!=null)callback.result(outcome);
        });
    }
    private static JSONObject perform(Context c) throws Exception {
        synchronized(LOCK) {
            JSONArray rows=load(c);
            if(countToday(rows)>=MAX_DAILY){
                JSONObject result=status(c);
                result.put("notice","Limite di "+MAX_DAILY+" nuove nozioni giornaliere raggiunto.");return result;
            }
            Set<String> seen=new HashSet<>();
            for(int i=0;i<rows.length();i++)seen.add(rows.optJSONObject(i).optString("url"));
            String today=LocalDate.now(ROME).toString();
            int added=0;
            int remaining=MAX_DAILY-countToday(rows);
            for(int i=0;i<6 && added<remaining;i++){
                int index=(int)((LocalDate.now(ROME).toEpochDay()+i)%SUBJECTS.length);
                String title=SUBJECTS[index];
                String host="it.wikipedia.org";
                // Wikipedia is the verified encyclopedia; Wikibooks and Wikiversity
                // remain visible as optional research links in the launcher.
                JSONObject page=fetch(host,title,today);
                if(page==null || seen.contains(page.optString("url")))continue;
                if(rows.length()>=MAX_TOTAL){
                    JSONArray trimmed=new JSONArray();
                    for(int j=1;j<rows.length();j++)trimmed.put(rows.get(j));
                    rows=trimmed;
                }
                rows.put(page);seen.add(page.optString("url"));added++;
            }
            if(added>0)save(c,rows);
            JSONObject result=status(c);
            result.put("added",added);
            if(added==0)result.put("notice","Nessuna nuova nozione verificata. Le fonti potrebbero essere indisponibili.");
            return result;
        }
    }
    private static JSONObject fetch(String host,String title,String today) {
        HttpURLConnection conn=null;
        try{
            String url="https://"+host+"/w/api.php?action=query&format=json&formatversion=2"
                +"&prop=extracts&exintro=1&explaintext=1&redirects=1&titles="
                +URLEncoder.encode(title,"UTF-8");
            conn=(HttpURLConnection)new URL(url).openConnection();
            conn.setInstanceFollowRedirects(false);
            conn.setConnectTimeout(6500);conn.setReadTimeout(6500);
            conn.setRequestProperty("User-Agent","UNVORStudy/1.0 (private educational Android client; source attribution in app)");
            conn.setRequestProperty("Accept","application/json");
            if(conn.getResponseCode()!=200)return null;
            ByteArrayOutputStream buffer=new ByteArrayOutputStream();
            try(InputStream in=conn.getInputStream()){
                byte[] part=new byte[4096];int n;
                while((n=in.read(part))!=-1){
                    if(buffer.size()+n>128*1024)return null;
                    buffer.write(part,0,n);
                }
            }
            JSONObject data=new JSONObject(new String(buffer.toByteArray(),StandardCharsets.UTF_8));
            JSONArray pages=data.getJSONObject("query").getJSONArray("pages");
            if(pages.length()==0)return null;
            JSONObject page=pages.getJSONObject(0);
            if(page.optBoolean("missing")||page.optString("title","").isEmpty())return null;
            String extract=page.optString("extract","").trim();
            extract=extract.replaceAll("\\s+"," ");
            if(extract.length()<80)return null;
            if(extract.length()>750)extract=extract.substring(0,750)+"…";
            String actualTitle=page.getString("title");
            String link="https://"+host+"/wiki/"+URLEncoder.encode(actualTitle.replace(' ','_'),"UTF-8");
            return new JSONObject().put("title",actualTitle).put("excerpt",extract)
                .put("url",link).put("source","Wikipedia in italiano")
                .put("license","CC BY-SA — vedi condizioni dell'articolo")
                .put("studiedAt",today);
        }catch(Exception ignored){return null;}
        finally{if(conn!=null)conn.disconnect();}
    }
}
