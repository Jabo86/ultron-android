package com.ultron.messenger

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioManager
import android.media.AudioDeviceInfo
import android.media.ToneGenerator
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.telecom.Connection
import android.telecom.DisconnectCause
import android.telecom.TelecomManager
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule

// Ponte fra il telecom di Android e il JS della schermata di chiamata.
// Ogni chiamata nativa e' in try/catch: se il telecom rifiuta (produttori che lo hanno
// mutilato, Android < 8, permesso negato) la chiamata di Lattice continua a funzionare
// come nella v2.3.3 — si perde la priorita di sistema, non la telefonata.
class CallControlModule(private val ctx: ReactApplicationContext) : ReactContextBaseJavaModule(ctx) {

  override fun getName() = "LatticeCallControl"

  init { react = ctx }

  private val audioHandler = Handler(Looper.getMainLooper())
  private var ringback: ToneGenerator? = null
  private val ringbackTick = object : Runnable {
    override fun run() {
      val tone = ringback ?: return
      try {
        tone.startTone(ToneGenerator.TONE_SUP_RINGTONE, 1000)
        audioHandler.postDelayed(this, 4000)
      } catch (e: RuntimeException) { clearRingback() }
    }
  }

  private fun clearRingback() {
    audioHandler.removeCallbacks(ringbackTick)
    ringback?.release()
    ringback = null
  }

  @ReactMethod
  fun startRingback(promise: Promise) {
    audioHandler.post {
      clearRingback()
      try {
        val tone = ToneGenerator(AudioManager.STREAM_VOICE_CALL, 80)
        ringback = tone
        if (!tone.startTone(ToneGenerator.TONE_SUP_RINGTONE, 1000)) {
          clearRingback()
          promise.resolve(false)
        } else {
          audioHandler.postDelayed(ringbackTick, 4000)
          promise.resolve(true)
        }
      } catch (e: RuntimeException) {
        clearRingback()
        promise.resolve(false)
      }
    }
  }

  @ReactMethod
  fun stopRingback(promise: Promise) {
    audioHandler.post { clearRingback(); promise.resolve(true) }
  }

  override fun invalidate() {
    audioHandler.post { clearRingback() }
    super.invalidate()
  }


  private var originalAudioMode: Int? = null

  // L'audio WebRTC e' indipendente dal suono della suoneria. Applichiamo
  // la modalita' voce e rendiamo selezionabile l'uscita anche su Android 12+.
  @Suppress("DEPRECATION")
  @ReactMethod
  fun setAudioRoute(speaker: Boolean, promise: Promise) {
    audioHandler.post {
      try {
        val audio = ctx.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        if (originalAudioMode == null) originalAudioMode = audio.mode
        audio.mode = AudioManager.MODE_IN_COMMUNICATION
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
          val current = audio.communicationDevice
          val external = current != null && (
            current.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO ||
            current.type == AudioDeviceInfo.TYPE_BLE_HEADSET ||
            current.type == AudioDeviceInfo.TYPE_WIRED_HEADSET ||
            current.type == AudioDeviceInfo.TYPE_WIRED_HEADPHONES ||
            current.type == AudioDeviceInfo.TYPE_USB_HEADSET
          )
          if (speaker || !external) {
            val kind = if (speaker) AudioDeviceInfo.TYPE_BUILTIN_SPEAKER else AudioDeviceInfo.TYPE_BUILTIN_EARPIECE
            val target = audio.availableCommunicationDevices.firstOrNull { it.type == kind }
            if (target != null) audio.setCommunicationDevice(target)
            else audio.isSpeakerphoneOn = speaker
          }
        } else {
          audio.isSpeakerphoneOn = speaker
        }
        promise.resolve(true)
      } catch (e: Throwable) { promise.resolve(false) }
    }
  }

  @Suppress("DEPRECATION")
  @ReactMethod
  fun clearAudioRoute(promise: Promise) {
    audioHandler.post {
      try {
        val audio = ctx.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) audio.clearCommunicationDevice()
        else audio.isSpeakerphoneOn = false
        originalAudioMode?.let { if (audio.mode == AudioManager.MODE_IN_COMMUNICATION) audio.mode = it }
        originalAudioMode = null
        promise.resolve(true)
      } catch (e: Throwable) { promise.resolve(false) }
    }
  }

  @ReactMethod
  fun available(promise: Promise) {
    promise.resolve(Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && hasPerm())
  }

  private fun hasPerm(): Boolean =
    ctx.checkSelfPermission(Manifest.permission.MANAGE_OWN_CALLS) == PackageManager.PERMISSION_GRANTED

  @ReactMethod
  fun register(promise: Promise) {
    promise.resolve(UltronConnectionService.register(ctx))
  }

  /// Chiamata in USCITA: la dichiariamo al sistema PRIMA di aprire il microfono.
  @ReactMethod
  fun startOutgoing(label: String, promise: Promise) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O || !hasPerm()) { promise.resolve(false); return }
    try {
      UltronConnectionService.register(ctx)
      val tm = ctx.getSystemService(Context.TELECOM_SERVICE) as TelecomManager
      val extras = Bundle()
      extras.putParcelable(TelecomManager.EXTRA_PHONE_ACCOUNT_HANDLE, UltronConnectionService.handle(ctx))
      extras.putBoolean(TelecomManager.EXTRA_START_CALL_WITH_VIDEO_STATE, false)
      tm.placeCall(uriFor(label), extras)
      promise.resolve(true)
    } catch (e: Throwable) { promise.resolve(false) }
  }

  /// Chiamata in ARRIVO. Autogestita: la finestra di risposta resta la nostra
  /// (`onShowIncomingCallUi`), il sistema sa soltanto che il telefono sta squillando.
  @ReactMethod
  fun reportIncoming(label: String, promise: Promise) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O || !hasPerm()) { promise.resolve(false); return }
    try {
      UltronConnectionService.register(ctx)
      val tm = ctx.getSystemService(Context.TELECOM_SERVICE) as TelecomManager
      val extras = Bundle()
      extras.putParcelable(TelecomManager.EXTRA_INCOMING_CALL_ADDRESS, uriFor(label))
      tm.addNewIncomingCall(UltronConnectionService.handle(ctx), extras)
      promise.resolve(true)
    } catch (e: Throwable) { promise.resolve(false) }
  }

  @ReactMethod
  fun setActive(promise: Promise) {
    try { UltronConnectionService.current?.setActive(); promise.resolve(true) }
    catch (e: Throwable) { promise.resolve(false) }
  }

  @ReactMethod
  fun end(promise: Promise) {
    audioHandler.post { clearRingback() }
    try {
      val c = UltronConnectionService.current
      c?.setDisconnected(DisconnectCause(DisconnectCause.LOCAL))
      c?.destroy()
      UltronConnectionService.current = null
      promise.resolve(true)
    } catch (e: Throwable) { promise.resolve(false) }
  }

  @ReactMethod
  fun state(promise: Promise) {
    promise.resolve(try { UltronConnectionService.state() } catch (e: Throwable) { "none" })
  }

  // Gli eventi arrivano dal thread del telecom: `addListener`/`removeListeners` servono
  // solo a zittire l'avviso di RN sul NativeEventEmitter.
  @ReactMethod fun addListener(name: String) { }
  @ReactMethod fun removeListeners(n: Int) { }

  private fun uriFor(label: String): Uri {
    val safe = label.ifBlank { "lattice" }.replace(Regex("[^A-Za-z0-9._@-]"), "")
    return Uri.fromParts("sip", safe.ifBlank { "lattice" }, null)
  }

  companion object {
    private var react: ReactApplicationContext? = null

    fun emit(action: String, detail: String) {
      val c = react ?: return
      try {
        if (!c.hasActiveReactInstance()) return
        val m = Arguments.createMap()
        m.putString("action", action)
        m.putString("detail", detail)
        c.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
          .emit("LatticeCallAction", m)
      } catch (e: Throwable) { /* la schermata di chiamata continua senza il telecom */ }
    }
  }
}
