package com.ultron.launcher;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.provider.ContactsContract;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.HashSet;
import java.util.Set;

/** No sync, upload or persistence: accesses the user-authorized Android phone directory. */
public final class PhoneContacts {
    private PhoneContacts() {}
    public static JSONObject read(Context context) {
        JSONObject response=new JSONObject();
        try {
            boolean granted=context.checkSelfPermission(Manifest.permission.READ_CONTACTS)==PackageManager.PERMISSION_GRANTED;
            response.put("permission",granted);
            JSONArray contacts=new JSONArray();response.put("contacts",contacts);
            if(!granted)return response;
            String[] projection={
                ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME,
                ContactsContract.CommonDataKinds.Phone.NUMBER
            };
            Set<String> seen=new HashSet<>();
            try(Cursor cursor=context.getContentResolver().query(
                ContactsContract.CommonDataKinds.Phone.CONTENT_URI,projection,
                null,null,ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME+" COLLATE LOCALIZED ASC")){
                if(cursor!=null)while(cursor.moveToNext()&&contacts.length()<1000) {
                    String name=cursor.getString(0),phone=cursor.getString(1);
                    if(phone==null||phone.trim().isEmpty())continue;
                    String id=(name==null?"":name)+"|"+phone;
                    if(!seen.add(id))continue;
                    contacts.put(new JSONObject()
                        .put("name",name==null||name.trim().isEmpty()?"Senza nome":name)
                        .put("phone",phone));
                }
            }catch(SecurityException e){response.put("permission",false);}
            catch(Exception e){response.put("message","Rubrica non leggibile sul telefono");}
        }catch(Exception ignored){}
        return response;
    }
}