package com.ultron.launcher;

import android.Manifest;
import android.content.ContentUris;
import android.content.Context;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.provider.CalendarContract;
import org.json.JSONArray;
import org.json.JSONObject;
import java.time.LocalDate;
import java.time.YearMonth;
import java.time.ZoneId;
import java.time.Instant;
import java.time.ZoneOffset;

/** Read-only view of calendars the user has made available to Android.
 *  No Google account, network service, or calendar write permission is required.
 */
public final class PhoneCalendar {
    private PhoneCalendar() {}
    public static JSONObject month(Context context,String rawMonth) {
        JSONObject result=new JSONObject();
        try {
            YearMonth month;
            try { month=YearMonth.parse(rawMonth); }
            catch(Exception ignored) { month=YearMonth.now(); }
            String ym=month.toString();
            result.put("month",ym);
            boolean granted=context.checkSelfPermission(Manifest.permission.READ_CALENDAR)==PackageManager.PERMISSION_GRANTED;
            result.put("permission",granted);
            JSONArray events=new JSONArray();
            result.put("events",events);
            if(!granted)return result;
            // Include overlap around the edges of the displayed month, maximum two months of data.
            ZoneId zone=ZoneId.systemDefault();
            long start=month.atDay(1).minusDays(7).atStartOfDay(zone).toInstant().toEpochMilli();
            long end=month.plusMonths(1).atDay(1).plusDays(7).atStartOfDay(zone).toInstant().toEpochMilli();
            Uri.Builder builder=CalendarContract.Instances.CONTENT_URI.buildUpon();
            ContentUris.appendId(builder,start);
            ContentUris.appendId(builder,end);
            String[] columns={
                CalendarContract.Instances.EVENT_ID,
                CalendarContract.Instances.TITLE,
                CalendarContract.Instances.BEGIN,
                CalendarContract.Instances.END,
                CalendarContract.Instances.ALL_DAY,
                CalendarContract.Instances.CALENDAR_DISPLAY_NAME,
                CalendarContract.Instances.EVENT_LOCATION
            };
            try(Cursor cursor=context.getContentResolver().query(builder.build(),columns,null,null,
                    CalendarContract.Instances.BEGIN+" ASC")){
                if(cursor!=null)while(cursor.moveToNext()&&events.length()<500){
                    long begin=cursor.getLong(2),finish=cursor.getLong(3);
                    boolean allDay=cursor.getInt(4)!=0;
                    // Android all-day instances use UTC-midnight, independent from local time zone.
                    String date=(allDay?Instant.ofEpochMilli(begin).atZone(ZoneOffset.UTC):
                                      Instant.ofEpochMilli(begin).atZone(zone)).toLocalDate().toString();
                    JSONObject entry=new JSONObject();
                    entry.put("id","android:"+cursor.getLong(0)+":"+begin);
                    entry.put("title",cursor.isNull(1)?"(senza titolo)":cursor.getString(1));
                    entry.put("startMs",begin);
                    entry.put("endMs",finish);
                    entry.put("date",date);
                    entry.put("allDay",allDay);
                    entry.put("source","android");
                    entry.put("calendar",cursor.isNull(5)?"Calendario Android":cursor.getString(5));
                    entry.put("location",cursor.isNull(6)?"":cursor.getString(6));
                    events.put(entry);
                }
            } catch(SecurityException e){
                result.put("permission",false);result.put("message","Permesso Calendario non disponibile");
            } catch(Exception e){result.put("message","Calendari del telefono non disponibili: controlla le autorizzazioni");}
        }catch(Exception error){try{result.put("message","Impossibile leggere il calendario");}catch(Exception ignored){}}
        return result;
    }
}