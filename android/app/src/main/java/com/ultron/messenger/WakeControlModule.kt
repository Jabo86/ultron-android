package com.ultron.messenger

import android.app.NotificationManager
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/** Controllo del servizio notifiche proprietario UNVOR.
 * Non usa Firebase, FCM, Play Services o token del dispositivo.
 */
class WakeControlModule(ctx: ReactApplicationContext) : ReactContextBaseJavaModule(ctx) {
    override fun getName(): String = "WakeControl"

    @ReactMethod
    fun fullScreenCallsAllowed(promise: Promise) {
        val nm = reactApplicationContext.getSystemService(NotificationManager::class.java)
        promise.resolve(Build.VERSION.SDK_INT < 34 || nm.canUseFullScreenIntent())
    }

    @ReactMethod
    fun openFullScreenCallSettings(promise: Promise) {
        val ctx = reactApplicationContext
        try {
            val action = if (Build.VERSION.SDK_INT >= 34) Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT
                else Settings.ACTION_APPLICATION_DETAILS_SETTINGS
            val intent = Intent(action, Uri.parse("package:" + ctx.packageName))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            ctx.startActivity(intent)
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("CALL_SETTINGS", "Android settings unavailable", e)
        }
    }

    @ReactMethod
    fun takeIncomingCall(promise: Promise) {
        val activity = reactApplicationContext.currentActivity
        if (activity == null) { promise.resolve(null); return }
        activity.runOnUiThread {
            val intent = activity.intent
            val rid = intent?.getStringExtra(WakeService.CALL_RID)
            val answer = intent?.getBooleanExtra(WakeService.CALL_ANSWER, false) == true
            intent?.removeExtra(WakeService.CALL_RID)
            intent?.removeExtra(WakeService.CALL_ANSWER)
            if (rid == null || !WakeService.isIncomingCall(rid)) {
                promise.resolve(null)
            } else {
                promise.resolve(Arguments.createMap().apply {
                    putString("rid", rid)
                    putBoolean("answer", answer)
                })
            }
        }
    }

    @ReactMethod
    fun pause(promise: Promise) {
        try {
            val ctx = reactApplicationContext
            ctx.stopService(Intent(ctx, WakeService::class.java))
            val notifications = ctx.getSystemService(NotificationManager::class.java)
            notifications.cancel(WakeService.MESSAGE_ID)
            notifications.cancel(WakeService.CALL_ID)
            notifications.cancel(WakeService.CONTACT_ID)
            val activity = ctx.currentActivity
            if (activity == null) promise.resolve(null)
            else activity.runOnUiThread {
                activity.intent?.removeExtra(WakeService.CALL_RID)
                promise.resolve(null)
            }
        } catch (e: Exception) {
            promise.reject("WAKE_PAUSE", e)
        }
    }

    @ReactMethod
    fun start(promise: Promise) {
        try {
            promise.resolve(WakeService.start(reactApplicationContext))
        } catch (e: Exception) {
            promise.reject("WAKE_START", e)
        }
    }
}
