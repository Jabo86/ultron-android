package com.ultron.messenger

import android.app.Activity
import android.content.Intent
import com.facebook.react.bridge.BaseActivityEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.journeyapps.barcodescanner.ScanOptions

class QrScanModule(private val ctx: ReactApplicationContext) : ReactContextBaseJavaModule(ctx) {
  private var pending: Promise? = null

  init {
    ctx.addActivityEventListener(object : BaseActivityEventListener() {
      override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode != REQUEST) return
        val result = pending ?: return
        pending = null
        val contents = if (resultCode == Activity.RESULT_OK) data?.getStringExtra("SCAN_RESULT") else null
        result.resolve(contents)
      }
    })
  }

  override fun getName() = "UltronQrScan"

  @ReactMethod
  fun scan(prompt: String, promise: Promise) {
    val activity = ctx.currentActivity
    if (activity == null) {
      promise.reject("qr_unavailable", "Camera unavailable")
      return
    }
    activity.runOnUiThread {
      if (pending != null) {
        promise.reject("qr_busy", "A scanner is already open")
        return@runOnUiThread
      }
      pending = promise
      try {
        val options = ScanOptions()
          .setDesiredBarcodeFormats(listOf("QR_CODE"))
          .setPrompt(prompt)
          .setBeepEnabled(false)
          .setBarcodeImageEnabled(false)
        @Suppress("DEPRECATION")
        activity.startActivityForResult(options.createScanIntent(activity), REQUEST)
      } catch (e: Exception) {
        pending = null
        promise.reject("qr_failed", "Could not open QR scanner", e)
      }
    }
  }

  companion object { private const val REQUEST = 47061 }
}
