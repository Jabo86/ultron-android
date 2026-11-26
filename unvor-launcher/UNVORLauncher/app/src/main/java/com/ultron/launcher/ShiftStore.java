package com.ultron.launcher;

import android.content.Context;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.AtomicFile;
import org.json.JSONArray;
import org.json.JSONObject;
import org.json.JSONException;
import java.io.File;
import java.io.FileNotFoundException;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.temporal.ChronoUnit;
import java.util.UUID;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import java.util.Arrays;

/** On-device customizable work shifts. Never contacts a server or a Google service. */
public final class ShiftStore {
    private ShiftStore() {}
    private static final Object LOCK=new Object();
    private static final String ALIAS="unvor_shift_types_v138";
    private static final int MAX_USERS=12,MAX_TYPES=80,MAX_DAYS=366,MAX_ASSIGNMENTS=12000;
    private static AtomicFile file(Context c) {return new AtomicFile(new File(c.getNoBackupFilesDir(),"unvor_turni_v138.enc"));}
    private static SecretKey key() throws Exception {
        KeyStore store=KeyStore.getInstance("AndroidKeyStore");store.load(null);
        if(store.containsAlias(ALIAS))return ((KeyStore.SecretKeyEntry)store.getEntry(ALIAS,null)).getSecretKey();
        KeyGenerator gen=KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore");
        gen.init(new KeyGenParameterSpec.Builder(ALIAS,KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256).build());return gen.generateKey();
    }
    private static JSONObject type(String id,String name,String code,String color,int minutes)throws Exception{
        return new JSONObject().put("id",id).put("name",name).put("code",code)
            .put("color",color).put("minutes",minutes).put("start","").put("end","").put("pause",0).put("manual",true);
    }
    private static JSONObject defaults() throws Exception {
        JSONArray users=new JSONArray().put(new JSONObject().put("id","fabio").put("name","Fabio").put("targetMinutes",360))
            .put(new JSONObject().put("id","katia").put("name","Katia").put("targetMinutes",360));
        JSONArray types=new JSONArray();
        types.put(type("m","Mattina","M","#18D895",435));
        types.put(type("p","Pomeriggio","P","#FFD82B",435));
        types.put(type("n","Notte","N","#05D8F9",195));
        types.put(type("s","Smonto","S","#FF9F38",420));
        types.put(type("r","Riposo","R","#326FFF",0));
        types.put(type("f","Ferie","F","#E848CF",360));
        types.put(type("c","Congedo","C","#B85AF5",360));
        types.put(type("art21","Articolo 21","ART21","#69DD6E",360));
        types.put(type("art40","Articolo 40","ART40","#F5B644",360));
        types.put(type("mal","Malattia","MAL","#FF5674",360));
        return new JSONObject().put("users",users).put("templates",types)
            .put("assignments",new JSONArray()).put("schema",1);
    }
    private static JSONObject read(Context c)throws Exception{
        byte[] bytes;
        try {bytes=file(c).readFully();}
        catch(FileNotFoundException e){
            if(!file(c).getBaseFile().exists()&&!new File(file(c).getBaseFile().getPath()+".bak").exists())return defaults();
            throw e;
        }
        if(bytes.length<30||bytes[0]!=1)throw new IOException("Formato archivio turni non valido");
        Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE,key(),new GCMParameterSpec(128,Arrays.copyOfRange(bytes,1,13)));
        return new JSONObject(new String(cipher.doFinal(Arrays.copyOfRange(bytes,13,bytes.length)),StandardCharsets.UTF_8));
    }
    private static void write(Context c,JSONObject json)throws Exception{
        Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,key());
        byte[] encrypted=cipher.doFinal(json.toString().getBytes(StandardCharsets.UTF_8));
        byte[] iv=cipher.getIV();FileOutputStream out=null;AtomicFile af=file(c);
        try {out=af.startWrite();out.write(1);out.write(iv);out.write(encrypted);af.finishWrite(out);}
        catch(Exception e){if(out!=null)af.failWrite(out);throw e;}
    }
    private static String bounded(String value,int max,String field){
        String v=value==null?"":value.trim();
        if(v.isEmpty()||v.length()>max)throw new IllegalArgumentException(field+" non valido (massimo "+max+" caratteri)");
        return v;
    }
    private static JSONArray remove(JSONArray arr,String field,String id)throws Exception{
        JSONArray result=new JSONArray();
        for(int i=0;i<arr.length();i++){JSONObject row=arr.getJSONObject(i);if(!id.equals(row.optString(field)))result.put(row);}
        return result;
    }
    private static JSONObject find(JSONArray arr,String id)throws Exception{
        for(int i=0;i<arr.length();i++){JSONObject r=arr.getJSONObject(i);if(id.equals(r.optString("id")))return r;}
        return null;
    }
    private static LocalDate day(String s){try{return LocalDate.parse(s);}catch(Exception e){throw new IllegalArgumentException("Data non valida");}}
    private static boolean hasUser(JSONObject data,String id)throws Exception{return find(data.getJSONArray("users"),id)!=null;}
    private static boolean hasTemplate(JSONObject data,String id)throws Exception{return find(data.getJSONArray("templates"),id)!=null;}
    private static void assign(JSONObject data,String user,String date,String type)throws Exception{
        JSONArray a=data.getJSONArray("assignments"),updated=new JSONArray();
        for(int i=0;i<a.length();i++){
            JSONObject row=a.getJSONObject(i);
            if(!user.equals(row.optString("user"))||!date.equals(row.optString("date")))updated.put(row);
        }
        if(type!=null&&!type.isEmpty())updated.put(new JSONObject().put("user",user).put("date",date).put("template",type));
        if(updated.length()>MAX_ASSIGNMENTS)throw new IllegalArgumentException("Archivio pieno: cancella i turni non necessari");
        data.put("assignments",updated);
    }
    public static JSONObject snapshot(Context c)throws Exception{synchronized(LOCK){return read(c);}}
    public static JSONObject apply(Context c,JSONObject request)throws Exception{
        synchronized(LOCK){
            JSONObject data=read(c);String action=request.optString("op","");
            if("saveTemplate".equals(action)){
                String name=bounded(request.optString("name"),60,"Nome turno");
                String code=bounded(request.optString("code").toUpperCase(java.util.Locale.ITALIAN),6,"Sigla");
                String color=request.optString("color","#00CFFF").toUpperCase(java.util.Locale.ROOT);
                if(!color.matches("#[0-9A-F]{6}"))throw new IllegalArgumentException("Colore non valido");
                String id=request.optString("id","");
                if(!id.isEmpty()&&find(data.getJSONArray("templates"),id)==null)throw new IllegalArgumentException("Turno non trovato");
                if(id.isEmpty())id="t-"+UUID.randomUUID().toString();
                String start=request.optString("start","").trim(),end=request.optString("end","").trim();
                int pause=request.optInt("pause",0);
                if(pause<0||pause>1439)throw new IllegalArgumentException("Pausa non valida");
                boolean manual=request.optBoolean("manual",false);
                int minutes;
                if(!start.isEmpty()||!end.isEmpty()){
                    LocalTime a,b;
                    try{a=LocalTime.parse(start);b=LocalTime.parse(end);}catch(Exception e){throw new IllegalArgumentException("Orario non valido");}
                    long diff=ChronoUnit.MINUTES.between(a,b);
                    if(diff<=0)diff+=1440;
                    if(pause>=diff)throw new IllegalArgumentException("Pausa maggiore del turno");
                    minutes=manual?request.optInt("minutes",-1):(int)(diff-pause);
                }else{
                    if(!start.isEmpty()||!end.isEmpty())throw new IllegalArgumentException("Servono entrambi gli orari");
                    minutes=request.optInt("minutes",-1);
                    manual=true;
                }
                if(minutes<0||minutes>2880)throw new IllegalArgumentException("Durata non valida (0–2880 minuti)");
                JSONArray types=data.getJSONArray("templates");
                if(find(types,id)==null&&types.length()>=MAX_TYPES)throw new IllegalArgumentException("Massimo 80 tipi di turno");
                types=remove(types,"id",id);
                types.put(new JSONObject().put("id",id).put("name",name).put("code",code).put("color",color)
                    .put("minutes",minutes).put("start",start).put("end",end).put("pause",pause).put("manual",manual));
                data.put("templates",types);
            }else if("deleteTemplate".equals(action)){
                String id=request.optString("id","");
                if(!hasTemplate(data,id))throw new IllegalArgumentException("Turno inesistente");
                data.put("templates",remove(data.getJSONArray("templates"),"id",id));
                JSONArray all=data.getJSONArray("assignments"),out=new JSONArray();
                for(int i=0;i<all.length();i++){JSONObject row=all.getJSONObject(i);if(!id.equals(row.optString("template")))out.put(row);}
                data.put("assignments",out);
            }else if("renameUser".equals(action)){
                JSONObject user=find(data.getJSONArray("users"),request.optString("id",""));
                if(user==null)throw new IllegalArgumentException("Profilo non trovato");
                user.put("name",bounded(request.optString("name"),36,"Nome persona"));
                int target=request.optInt("targetMinutes",360);
                if(target<0||target>1440)throw new IllegalArgumentException("Ore di riferimento non valide");
                user.put("targetMinutes",target);
            }else if("addUser".equals(action)){
                JSONArray users=data.getJSONArray("users");
                if(users.length()>=MAX_USERS)throw new IllegalArgumentException("Limite di persone raggiunto");
                users.put(new JSONObject().put("id","u-"+UUID.randomUUID()).put("name",bounded(request.optString("name"),36,"Nome persona")).put("targetMinutes",360));
            }else if("deleteUser".equals(action)){
                String id=request.optString("id","");
                JSONArray users=data.getJSONArray("users");
                if(users.length()<2)throw new IllegalArgumentException("Mantieni almeno un profilo");
                if(!hasUser(data,id))throw new IllegalArgumentException("Persona non trovata");
                data.put("users",remove(users,"id",id));
                data.put("assignments",remove(data.getJSONArray("assignments"),"user",id));
            }else if("assign".equals(action)||"range".equals(action)||"cycle".equals(action)){
                String user=request.optString("user",""),template=request.optString("template","");
                if(!hasUser(data,user))throw new IllegalArgumentException("Persona non valida");
                if(!"cycle".equals(action)&&!template.isEmpty()&&!hasTemplate(data,template))throw new IllegalArgumentException("Tipo di turno non valido");
                LocalDate from=day(request.optString("from",""));
                LocalDate to="assign".equals(action)?from:day(request.optString("to",""));
                long count=ChronoUnit.DAYS.between(from,to)+1;
                if(count<1||count>MAX_DAYS)throw new IllegalArgumentException("Intervallo massimo: 366 giorni");
                JSONArray sequence=request.optJSONArray("sequence");
                if("cycle".equals(action)){
                    if(sequence==null||sequence.length()==0||sequence.length()>31)throw new IllegalArgumentException("Ciclo non valido");
                    for(int j=0;j<sequence.length();j++){
                        String t=sequence.getString(j);
                        if(!t.isEmpty()&&!hasTemplate(data,t))throw new IllegalArgumentException("Turno del ciclo inesistente");
                    }
                }
                for(int i=0;i<count;i++){
                    String type="cycle".equals(action)?sequence.getString(i%sequence.length()):template;
                    assign(data,user,from.plusDays(i).toString(),type);
                }
            }else throw new IllegalArgumentException("Azione non riconosciuta");
            write(c,data);return data;
        }
    }
}
