package com.ultron.messenger

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException

class RelaySignerModule(ctx: ReactApplicationContext) : ReactContextBaseJavaModule(ctx) {
  private val worker = Executors.newSingleThreadExecutor()

  override fun getName() = "UltronRelaySigner"

  @ReactMethod
  fun sign(messageHex: String, contextHex: String, keyHex: String, promise: Promise) {
    if (keyHex.length != 8064 || messageHex.length !in 2..2048 ||
        messageHex.length % 2 != 0 || contextHex.length > 510 || contextHex.length % 2 != 0) {
      promise.reject("relay_sign_input", "Invalid relay signing input")
      return
    }
    try {
      worker.execute {
        try {
          promise.resolve(RelayRequestSigner.sign(messageHex, contextHex, keyHex))
        } catch (_: Exception) {
          promise.reject("relay_sign_failed", "Relay signature failed")
        }
      }
    } catch (_: RejectedExecutionException) {
      promise.reject("relay_sign_closed", "Relay signer closed")
    }
  }

  override fun invalidate() {
    worker.shutdownNow()
    super.invalidate()
  }
}
