package com.ultron.messenger

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/** Controllo del servizio notifiche proprietario ULTRON.
 * Non usa Firebase, FCM, Play Services o token del dispositivo.
 */
class WakeControlModule(ctx: ReactApplicationContext) : ReactContextBaseJavaModule(ctx) {
    override fun getName(): String = "WakeControl"

    @ReactMethod
    fun start(promise: Promise) {
        try {
            promise.resolve(WakeService.start(reactApplicationContext))
        } catch (e: Exception) {
            promise.reject("WAKE_START", e)
        }
    }
}
