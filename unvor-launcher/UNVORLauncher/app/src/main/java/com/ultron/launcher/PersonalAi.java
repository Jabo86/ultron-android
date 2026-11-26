package com.ultron.launcher;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Handler;
import android.os.Looper;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * UNVOR Personal AI — BYOK: keys are unique to the Android app profile.
 * No keys are supplied by the developer or synchronized with UNVOR Chat/VPS.
 * Only HTTPS endpoints; the remote Ollama host must be exposed securely.
 */
public final class PersonalAi {
    public interface Callback { void result(String type, Object data); }
    private static final String KEY_ALIAS = "unvor.personal.ai.aes.v1";
    private static final String SYS = "Sei UNVOR, assistente per domande quotidiane. Rispondi in italiano, in 2 o 3 frasi, senza introduzioni inutili. Se non sai qualcosa, dillo.";
    private static final int MAX_ANSWER = 1000;
    private static final String[][] CATALOG = {
        {"groq","Groq","openai/gpt-oss-120b","https://api.groq.com/openai/v1/chat/completions"},
        {"gemini","Google Gemini","gemini-2.5-flash","https://generativelanguage.googleapis.com"},
        {"cerebras","Cerebras","gpt-oss-120b","https://api.cerebras.ai/v1/chat/completions"},
        {"nvidia","NVIDIA NIM","","https://integrate.api.nvidia.com/v1/chat/completions"},
        {"openrouter","OpenRouter","openrouter/free","https://openrouter.ai/api/v1/chat/completions"},
        {"mistral","Mistral AI","mistral-small-latest","https://api.mistral.ai/v1/chat/completions"},
        {"sambanova","SambaNova","","https://api.sambanova.ai/v1/chat/completions"},
        {"github","GitHub Models","",""},
        {"ollama","Ollama sul Mac","",""},
        {"cervello","Cervello UNVOR Mac","",""},
        {"cloudflare","Cloudflare Workers AI","@cf/meta/llama-3.1-8b-instruct","https://api.cloudflare.com/client/v4/accounts/"},
        {"glm","GLM","","https://open.bigmodel.cn/api/paas/v4/chat/completions"},
        {"kimi","Kimi","","https://api.moonshot.cn/v1/chat/completions"}
    };
    private final SharedPreferences prefs;
    private final ExecutorService network = Executors.newSingleThreadExecutor();
    private final Handler main = new Handler(Looper.getMainLooper());
    public PersonalAi(Context context) {
        prefs=context.getApplicationContext().getSharedPreferences("unvor.personal.ai",Context.MODE_PRIVATE);
    }
    public void close(){network.shutdownNow();}
    private static String[] spec(String id) {
        for(String[] entry:CATALOG)if(entry[0].equals(id))return entry;
        return null;
    }
    private SecretKey encryptionKey() throws Exception {
        KeyStore store=KeyStore.getInstance("AndroidKeyStore");store.load(null);
        if(store.containsAlias(KEY_ALIAS))return (SecretKey)store.getKey(KEY_ALIAS,null);
        KeyGenerator generator=KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(KEY_ALIAS,
            KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setRandomizedEncryptionRequired(true).build());
        return generator.generateKey();
    }
    private String seal(String plain) throws Exception {
        Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE,encryptionKey());
        byte[] data=cipher.doFinal(plain.getBytes(StandardCharsets.UTF_8));
        byte[] iv=cipher.getIV();
        byte[] all=new byte[iv.length+data.length];
        System.arraycopy(iv,0,all,0,iv.length);
        System.arraycopy(data,0,all,iv.length,data.length);
        return Base64.encodeToString(all,Base64.NO_WRAP);
    }
    private String open(String encoded) throws Exception {
        byte[] all=Base64.decode(encoded,Base64.DEFAULT);
        if(all.length<29)throw new Exception("Dati cifrati non validi");
        byte[] iv=new byte[12];
        System.arraycopy(all,0,iv,0,12);
        Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE,encryptionKey(),new GCMParameterSpec(128,iv));
        return new String(cipher.doFinal(all,12,all.length-12),StandardCharsets.UTF_8);
    }
    private JSONObject config(String id) {
        String ciphertext=prefs.getString("cfg."+id,null);
        if(ciphertext==null)return null;
        try {return new JSONObject(open(ciphertext));}
        catch(Exception e){return null;}
    }
    private static String safeHttps(String raw) throws Exception {
        URI uri=new URI(raw);
        if(!"https".equalsIgnoreCase(uri.getScheme())||uri.getHost()==null||
            uri.getUserInfo()!=null||uri.getFragment()!=null||uri.getQuery()!=null)
            throw new Exception("Per le API serve un indirizzo HTTPS valido.");
        return uri.toString().replaceAll("/+$","");
    }
    public JSONObject save(String id,String key,String model,String endpoint,int priority,boolean enabled,String accountId) throws Exception {
        String[] entry=spec(id);
        if(entry==null||"github".equals(id))throw new Exception("Provider non disponibile.");
        if(priority<0||priority>3)throw new Exception("Priorità: 0 (riserva) oppure 1, 2, 3.");
        if(model==null||model.trim().isEmpty()||model.length()>120)throw new Exception("Inserisci il modello fornito dal servizio.");
        if(!model.matches("[a-zA-Z0-9_@./:\\-]+"))throw new Exception("Nome modello non valido.");
        JSONObject existing=config(id);
        String secret=key==null||key.trim().isEmpty()?(existing==null?"":existing.optString("key","")):key.trim();
        if(secret.length()>4096)throw new Exception("Chiave troppo lunga.");
        if(!"ollama".equals(id)&&secret.isEmpty())throw new Exception("Inserisci la tua chiave API personale.");
        String address="";
        if("ollama".equals(id)||"cervello".equals(id)){
            address=safeHttps(endpoint==null?"":endpoint.trim());
            if(!("ollama".equals(id)?address.endsWith("/api/chat"):address.endsWith("/chat/completions")))
                throw new Exception("Indirizzo HTTPS: deve terminare con /api/chat (Ollama) oppure /chat/completions (UNVOR Mac).");
        }
        if("cloudflare".equals(id)){
            if(accountId==null||!accountId.matches("[a-zA-Z0-9_-]{6,80}"))throw new Exception("Account ID Cloudflare non valido.");
        }
        JSONObject cfg=new JSONObject();
        cfg.put("key",secret).put("model",model.trim()).put("endpoint",address)
            .put("priority",priority).put("enabled",enabled).put("accountId",accountId==null?"":accountId);
        // Enforce one selected provider per slot. Others remain saved as reserve.
        SharedPreferences.Editor changes=prefs.edit();
        if(enabled&&priority>0){
            for(String[] other:CATALOG){
                if(other[0].equals(id))continue;
                JSONObject old=config(other[0]);
                if(old!=null&&old.optBoolean("enabled")&&old.optInt("priority")==priority){
                    old.put("priority",0).put("enabled",false);
                    changes.putString("cfg."+other[0],seal(old.toString()));
                }
            }
        }
        changes.putString("cfg."+id,seal(cfg.toString()));
        if(!changes.commit())throw new Exception("Salvataggio non riuscito.");
        return list();
    }
    public JSONObject delete(String id) throws Exception {
        if(spec(id)==null)throw new Exception("Provider inesistente.");
        if(!prefs.edit().remove("cfg."+id).commit())throw new Exception("Rimozione non riuscita.");
        return list();
    }
    public JSONObject list() throws Exception {
        JSONArray rows=new JSONArray();int active=0,configured=0;
        for(String[] e:CATALOG) {
            JSONObject cfg=config(e[0]);
            boolean hasKey=cfg!=null&&("ollama".equals(e[0])||!cfg.optString("key","").isEmpty());
            boolean isActive=hasKey&&cfg.optBoolean("enabled")&&cfg.optInt("priority",0)>0;
            if(hasKey)configured++;
            if(isActive)active++;
            JSONObject row=new JSONObject();
            row.put("id",e[0]).put("name",e[1]).put("available",!"github".equals(e[0]))
                .put("configured",hasKey).put("active",isActive)
                .put("model",cfg==null?e[2]:cfg.optString("model",e[2]))
                .put("endpoint",cfg==null?"":cfg.optString("endpoint",""))
                .put("accountId",cfg==null?"":cfg.optString("accountId",""))
                .put("priority",cfg==null?0:cfg.optInt("priority",0))
                .put("requiresEndpoint","ollama".equals(e[0])||"cervello".equals(e[0]))
                .put("requiresAccount","cloudflare".equals(e[0]));
            rows.put(row);
        }
        return new JSONObject().put("rows",rows).put("configured",configured).put("active",active);
    }
    private static JSONObject msg(String role,String text) throws Exception {
        return new JSONObject().put("role",role).put("content",text);
    }
    private static String read(InputStream stream) throws Exception {
        try(InputStream input=stream;ByteArrayOutputStream out=new ByteArrayOutputStream()){
            byte[] buffer=new byte[4096];int n;
            while((n=input.read(buffer))!=-1){
                if(out.size()+n>131072)throw new Exception("Risposta del provider troppo grande.");
                out.write(buffer,0,n);
            }
            return out.toString("UTF-8");
        }
    }
    private String askOne(String id,JSONObject cfg,String question,boolean test) throws Exception {
        String[] entry=spec(id);
        if(entry==null||"github".equals(id))throw new Exception("Provider non disponibile.");
        String model=cfg.optString("model","");
        String endpoint=entry[3];
        if("ollama".equals(id)||"cervello".equals(id))endpoint=safeHttps(cfg.optString("endpoint",""));
        else if("gemini".equals(id))
            endpoint+="\/v1beta/models/"+model+":generateContent";
        else if("cloudflare".equals(id))
            endpoint+=cfg.optString("accountId","")+"/ai/v1/chat/completions";
        // Public provider destinations are fixed by the application: only the
        // two self-hosted configurations accept a custom HTTPS destination.
        URL url=new URL(endpoint);
        HttpURLConnection conn=(HttpURLConnection)url.openConnection();
        try {
            conn.setInstanceFollowRedirects(false);
            conn.setConnectTimeout(8000);conn.setReadTimeout(16000);
            conn.setRequestMethod("POST");conn.setDoOutput(true);
            conn.setRequestProperty("Content-Type","application/json; charset=utf-8");
            String secret=cfg.optString("key","");
            if("gemini".equals(id))conn.setRequestProperty("x-goog-api-key",secret);
            else if(!"ollama".equals(id))conn.setRequestProperty("Authorization","Bearer "+secret);
            JSONObject request=new JSONObject();
            if("gemini".equals(id)){
                request.put("contents",new JSONArray().put(new JSONObject().put("parts",
                    new JSONArray().put(new JSONObject().put("text",test?"Rispondi solamente OK":question)))));
                request.put("systemInstruction",new JSONObject().put("parts",new JSONArray().put(new JSONObject().put("text",SYS))));
                request.put("generationConfig",new JSONObject().put("maxOutputTokens",test?16:180));
            } else {
                request.put("model",model).put("stream",false);
                request.put("messages",new JSONArray().put(msg("system",SYS))
                    .put(msg("user",test?"Rispondi solamente OK":question)));
                if("ollama".equals(id))request.put("options",new JSONObject().put("num_predict",test?16:180));
                else request.put("max_tokens",test?16:180);
            }
            byte[] bytes=request.toString().getBytes(StandardCharsets.UTF_8);
            try(OutputStream output=conn.getOutputStream()){output.write(bytes);}
            int http=conn.getResponseCode();
            if(http<200||http>=300)throw new Exception("HTTP "+http);
            JSONObject response=new JSONObject(read(conn.getInputStream()));
            String answer;
            if("gemini".equals(id)){
                answer=response.getJSONArray("candidates").getJSONObject(0).getJSONObject("content")
                    .getJSONArray("parts").getJSONObject(0).optString("text","");
            }else if("ollama".equals(id)){
                answer=response.getJSONObject("message").optString("content","");
            }else{
                answer=response.getJSONArray("choices").getJSONObject(0)
                    .getJSONObject("message").optString("content","");
            }
            if(answer.trim().isEmpty())throw new Exception("Risposta vuota.");
            return answer.trim().length()<=MAX_ANSWER?answer.trim():answer.trim().substring(0,MAX_ANSWER)+"…";
        } finally {conn.disconnect();}
    }
    private static String code(Throwable error) {
        String detail=error.getMessage()==null?"errore":error.getMessage();
        if(detail.matches("HTTP [0-9]{3}"))return detail;
        if(error instanceof java.net.SocketTimeoutException)return "timeout";
        if(error instanceof java.net.UnknownHostException)return "DNS non raggiungibile";
        if(error instanceof javax.net.ssl.SSLException)return "TLS non valido";
        return "errore di collegamento o modello";
    }
    private void send(Callback callback,String type,Object value){
        main.post(()->callback.result(type,value));
    }
    public void testAll(Callback callback) {
        network.execute(()->{
            for(String[] e:CATALOG){
                String id=e[0];JSONObject cfg=config(id);
                if(cfg==null)continue;
                try {
                    askOne(id,cfg,"OK",true);
                    send(callback,"aiTest",new JSONObject().put("id",id).put("ok",true).put("status","Risponde"));
                }catch(Exception error){
                    try {send(callback,"aiTest",new JSONObject().put("id",id).put("ok",false).put("status",code(error)));}
                    catch(Exception ignored){}
                }
            }
            send(callback,"aiTestDone",true);
        });
    }
    public void ask(String question,Callback callback) {
        String prompt=question==null?"":question.trim();
        if(prompt.isEmpty()||prompt.length()>1000){send(callback,"aiAnswer","Scrivi una domanda di massimo 1000 caratteri.");return;}
        network.execute(()->{
            List<String> order=new ArrayList<>();
            for(int priority=1;priority<=3;priority++){
                for(String[] e:CATALOG){
                    JSONObject cfg=config(e[0]);
                    if(cfg!=null&&cfg.optBoolean("enabled")&&cfg.optInt("priority")==priority)order.add(e[0]);
                }
            }
            if(order.isEmpty()){send(callback,"aiAnswer","Configura uno o più cervelli AI in Impostazioni → AI personali.");return;}
            String last="servizio non raggiungibile";
            for(String id:order){
                JSONObject cfg=config(id);
                if(cfg==null)continue;
                try {
                    String answer=askOne(id,cfg,prompt,false);
                    try{send(callback,"aiAnswer",new JSONObject().put("text",answer).put("provider",spec(id)[1]));}
                    catch(Exception ignored){}
                    return;
                }catch(Exception error){last=code(error);}
            }
            send(callback,"aiAnswer","I cervelli selezionati non rispondono ("+last+"). Usa «Prova le AI ora» per controllarli.");
        });
    }
}
