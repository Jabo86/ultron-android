package com.ultron.messenger

import android.app.Application
import android.content.Context
import android.content.res.Configuration

import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.ReactHost
import com.facebook.react.common.ReleaseLevel
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint

import expo.modules.ApplicationLifecycleDispatcher
import expo.modules.ExpoReactHostFactory

class MainApplication : Application(), ReactApplication {

  override val reactHost: ReactHost by lazy {
    ExpoReactHostFactory.getDefaultReactHost(
      context = applicationContext,
      packageList =
        PackageList(this).packages.apply {
          add(UltronNativePackage())
        }
    )
  }

  // DIAGNOSTICA: registrato in attachBaseContext, cioe' PRIMA dei ContentProvider delle
  // librerie (che partono prima di Application.onCreate). E' la classe di arresto che ha
  // reso invisibile il crash della 1.2.8.
  override fun attachBaseContext(base: Context?) {
    super.attachBaseContext(base)
    installCrashHandler()
  }

  private fun installCrashHandler() {
    if (handlerInstalled) return
    handlerInstalled = true
    try {
      val prev = Thread.getDefaultUncaughtExceptionHandler()
      Thread.setDefaultUncaughtExceptionHandler { t, e ->
        val trace = (e.message ?: e.toString()) + "\n" + e.stackTraceToString().take(5000)
        try {
          java.io.File(filesDir, "nativecrash.txt").writeText(trace.take(6000))
        } catch (x: Throwable) { }
        // Invio della sola traccia tecnica: serve a capire gli arresti che avvengono prima
        // che l'app riesca a mostrare qualsiasi cosa. Nessun indirizzo, nessuna chiave.
        try {
          val body = org.json.JSONObject()
            .put("v", BuildConfig.VERSION_NAME)
            .put("android", android.os.Build.MODEL + " / API " + android.os.Build.VERSION.SDK_INT)
            .put("trace", trace)
            .toString()
          val c = (java.net.URL("https://49.12.242.0/api/public/crash").openConnection() as java.net.HttpURLConnection)
          c.requestMethod = "POST"
          c.connectTimeout = 4000
          c.readTimeout = 4000
          c.doOutput = true
          c.setRequestProperty("Content-Type", "application/json")
          c.outputStream.use { it.write(body.toByteArray()) }
          c.responseCode
          c.disconnect()
        } catch (x: Throwable) { }
        prev?.uncaughtException(t, e)
      }
    } catch (e: Throwable) { }
  }

  override fun onCreate() {
    super.onCreate()
    installCrashHandler()
    DefaultNewArchitectureEntryPoint.releaseLevel = try {
      ReleaseLevel.valueOf(BuildConfig.REACT_NATIVE_RELEASE_LEVEL.uppercase())
    } catch (e: IllegalArgumentException) {
      ReleaseLevel.STABLE
    }
    loadReactNative(this)
    ApplicationLifecycleDispatcher.onApplicationCreate(this)
  }

  override fun onConfigurationChanged(newConfig: Configuration) {
    super.onConfigurationChanged(newConfig)
    ApplicationLifecycleDispatcher.onConfigurationChanged(this, newConfig)
  }

  private companion object {
    @Volatile var handlerInstalled = false
  }
}
