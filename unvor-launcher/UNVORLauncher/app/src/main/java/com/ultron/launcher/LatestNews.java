package com.ultron.launcher;

import android.os.Handler;
import android.os.Looper;
import android.util.Xml;
import org.json.JSONArray;
import org.json.JSONObject;
import org.xmlpull.v1.XmlPullParser;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Verified headlines read directly from the publisher's personal RSS feed.
 * Not an LLM prediction, Mac synchronization or automated model training.
 * No remote user input, tracking identifiers, or API keys.
 */
public final class LatestNews {
    public interface Callback { void complete(JSONObject response); }
    private static final String FEED="https://www.ansa.it/sito/notizie/topnews/topnews_rss.xml";
    private final ExecutorService io=Executors.newSingleThreadExecutor();
    private final Handler main=new Handler(Looper.getMainLooper());
    private static final ZoneId ROME=ZoneId.of("Europe/Rome");
    public void close(){io.shutdownNow();}
    public void readToday(Callback cb) {
        io.execute(()->{
            JSONObject result=new JSONObject();
            try {
                JSONArray rows=load();
                result.put("items",rows);
                result.put("source","ANSA · RSS Ultima Ora");
                result.put("date",LocalDate.now(ROME).toString());
                result.put("ok",true);
                if(rows.length()==0)result.put("notice","Nessun titolo pubblicato oggi è stato verificato nel feed. Riprova più tardi.");
            }catch(Exception e){
                try {result.put("ok",false).put("items",new JSONArray()).put("source","ANSA · RSS Ultima Ora")
                    .put("notice","Notizie non disponibili: impossibile verificare il feed in questo momento.");}
                catch(Exception ignored){}
            }
            main.post(()->cb.complete(result));
        });
    }
    private static LocalDate dateOf(String raw) {
        if(raw==null||raw.isEmpty())return null;
        try {return ZonedDateTime.parse(raw.trim(),DateTimeFormatter.RFC_1123_DATE_TIME).withZoneSameInstant(ROME).toLocalDate();}
        catch(Exception ignored){}
        try {
            java.text.SimpleDateFormat fmt=new java.text.SimpleDateFormat("EEE, dd MMM yyyy HH:mm:ss Z",Locale.ENGLISH);
            fmt.setLenient(false);
            java.util.Date date=fmt.parse(raw.trim());
            return date==null?null:date.toInstant().atZone(ROME).toLocalDate();
        }catch(Exception ignored){return null;}
    }
    private static String value(String input,int limit) {
        if(input==null)return "";
        String plain=input.replaceAll("[\\p{Cntrl}&&[^\\n\\t]]"," ").replaceAll("\\s+"," ").trim();
        return plain.length()>limit?plain.substring(0,limit)+"…":plain;
    }
    private static JSONArray load() throws Exception {
        HttpURLConnection conn=(HttpURLConnection)new URL(FEED).openConnection();
        conn.setInstanceFollowRedirects(false);
        conn.setConnectTimeout(7500);
        conn.setReadTimeout(10000);
        conn.setRequestProperty("User-Agent","UNVOR-News-Reader/1.0");
        conn.setRequestProperty("Accept","application/rss+xml, application/xml, text/xml");
        try{
            if(conn.getResponseCode()!=200)throw new Exception("RSS HTTP error");
            int contentLength=conn.getContentLength();
            if(contentLength>1024*1024)throw new Exception("RSS exceeds limit");
            ByteArrayOutputStream output=new ByteArrayOutputStream();
            try(InputStream in=conn.getInputStream()){
                byte[] buf=new byte[4096];int count;
                while((count=in.read(buf))!=-1){
                    if(output.size()+count>1024*1024)throw new Exception("RSS too large");
                    output.write(buf,0,count);
                }
            }
            XmlPullParser parser=Xml.newPullParser();
            parser.setInput(new ByteArrayInputStream(output.toByteArray()),"UTF-8");
            JSONArray rows=new JSONArray();
            boolean inItem=false;
            String title="",date="",link="";
            LocalDate today=LocalDate.now(ROME);
            int event;
            while((event=parser.next())!=XmlPullParser.END_DOCUMENT && rows.length()<4){
                if(event==XmlPullParser.START_TAG){
                    String tag=parser.getName();
                    if("item".equals(tag)){inItem=true;title="";date="";link="";}
                    else if(inItem && "title".equals(tag))title=value(parser.nextText(),180);
                    else if(inItem && "pubDate".equals(tag))date=parser.nextText();
                    else if(inItem && "link".equals(tag))link=value(parser.nextText(),800);
                }else if(event==XmlPullParser.END_TAG && "item".equals(parser.getName()) && inItem){
                    inItem=false;
                    if(today.equals(dateOf(date)) && !title.isEmpty() && link.startsWith("https://www.ansa.it/"))
                        rows.put(new JSONObject().put("title",title).put("url",link).put("date",date));
                }
            }
            return rows;
        }finally{conn.disconnect();}
    }
}
