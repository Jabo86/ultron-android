package com.ultron.messenger

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

/**
 * Notifiche del nodo ULTRON, senza push di terze parti.
 * Tiene aperta una connessione in attesa verso il server ULTRON (long-poll) e mostra una
 * notifica locale quando ci sono messaggi. Non conosce chiavi, non decifra nulla: sa solo
 * che "c'è posta". Il contenuto lo legge l'app, dopo lo sblocco.
 */
class WakeService : Service() {
  @Volatile private var running = false
  private var worker: Thread? = null
  private var chaffWorker: Thread? = null

  companion object {
    const val CH_SERVICE = "lattice-wake"
    const val CH_CALL = "ultron-incoming-call"
    const val CALL_ID = 4713
    const val CALL_RID = "com.ultron.messenger.CALL_RID"
    const val CH_MSG = "lattice-wake-msg"
    const val FG_ID = 4711

    /** Configurazione scritta dall'app (JS) in files/wake.json */
    fun config(ctx: Context): JSONObject? = try {
      val f = File(ctx.filesDir, "wake.json")
      if (!f.exists()) null else JSONObject(f.readText())
    } catch (e: Exception) { null }

    fun wakeOn(ctx: Context): Boolean {
      val c = config(ctx) ?: return false
      return c.optBoolean("on", false) && c.optString("rid", "").length >= 32
    }

    fun chaffOn(ctx: Context): Boolean = config(ctx)?.optBoolean("chaff", false) ?: false

    fun enabled(ctx: Context): Boolean = wakeOn(ctx)

    // Il servizio si avvia se serve la sveglia OPPURE il rumore in background.
    fun shouldRun(ctx: Context): Boolean = wakeOn(ctx) || chaffOn(ctx)

    fun start(ctx: Context): Boolean {
      if (!shouldRun(ctx)) return false
      try {
        val i = Intent(ctx, WakeService::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) ctx.startForegroundService(i) else ctx.startService(i)
        return true
      } catch (e: Exception) { return false }
    }
  }

  private fun channels() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val nm = getSystemService(NotificationManager::class.java)
    val svc = NotificationChannel(CH_SERVICE, "Connessione ULTRON", NotificationManager.IMPORTANCE_MIN)
    svc.setShowBadge(false)
    nm.createNotificationChannel(svc)
    val msg = NotificationChannel(CH_MSG, "Messaggi", NotificationManager.IMPORTANCE_HIGH)
    nm.createNotificationChannel(msg)
    val call = NotificationChannel(CH_CALL, "Chiamate ULTRON", NotificationManager.IMPORTANCE_HIGH)
    val sound = android.media.RingtoneManager.getDefaultUri(android.media.RingtoneManager.TYPE_RINGTONE)
    val audio = android.media.AudioAttributes.Builder().setUsage(android.media.AudioAttributes.USAGE_NOTIFICATION_RINGTONE).build()
    call.setSound(sound, audio)
    call.enableVibration(true)
    nm.createNotificationChannel(call)
  }

  private fun openAppIntent(): PendingIntent {
    val i = Intent(this, MainActivity::class.java)
    i.flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
    val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M)
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE else PendingIntent.FLAG_UPDATE_CURRENT
    return PendingIntent.getActivity(this, 0, i, flags)
  }

  override fun onCreate() {
    super.onCreate()
    channels()
    val wake = wakeOn(this)
    val title = if (wake) "ULTRON in ascolto" else "Protezione traffico attiva"
    val body = if (wake) "Notifiche dal server ULTRON"
               else "Traffico invisibile: rumore di rete per nascondere quando comunichi"
    val n = NotificationCompat.Builder(this, CH_SERVICE)
      .setContentTitle(title)
      .setContentText(body)
      .setSmallIcon(applicationInfo.icon)
      .setOngoing(true)
      .setPriority(NotificationCompat.PRIORITY_MIN)
      .setContentIntent(openAppIntent())
      .build()
    try { startForeground(FG_ID, n) } catch (e: Exception) { /* permesso mancante */ }
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (!running) {
      running = true
      worker = Thread { loop() }.also { it.isDaemon = true; it.start() }
      chaffWorker = Thread { chaffLoop() }.also { it.isDaemon = true; it.start() }
    }
    return START_STICKY
  }

  private fun notifyMessages(n: Int) {
    try {
      val nm = getSystemService(NotificationManager::class.java)
      val text = if (n > 1) "Hai $n nuovi messaggi: aprili nell'app per leggerli."
                 else "Hai un nuovo messaggio: aprilo nell'app per leggerlo."
      val b = NotificationCompat.Builder(this, CH_MSG)
        .setContentTitle("Nuovo messaggio")
        .setContentText(text)
        .setSmallIcon(applicationInfo.icon)
        .setAutoCancel(true)
        .setPriority(NotificationCompat.PRIORITY_HIGH)
        .setContentIntent(openAppIntent())
      nm.notify(4712, b.build())
    } catch (e: Exception) { /* notifiche non concesse */ }
  }

  private fun notifyCall(rid: String) {
    try {
      val nm = getSystemService(NotificationManager::class.java)
      val intent = Intent(this, MainActivity::class.java)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        .putExtra(CALL_RID, rid)
      val open = PendingIntent.getActivity(this, CALL_ID, intent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
      val call = NotificationCompat.Builder(this, CH_CALL)
        .setContentTitle("Chiamata ULTRON")
        .setContentText("Tocca per aprire la chiamata")
        .setSmallIcon(applicationInfo.icon)
        .setCategory(NotificationCompat.CATEGORY_CALL)
        .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
        .setPriority(NotificationCompat.PRIORITY_MAX)
        .setAutoCancel(true)
        .setTimeoutAfter(35_000L)
        .setContentIntent(open)
      if (Build.VERSION.SDK_INT < 34 || nm.canUseFullScreenIntent()) {
        call.setFullScreenIntent(open, true)
      }
      nm.notify(CALL_ID, call.build())
    } catch (e: Exception) { /* permission or channel unavailable */ }
  }

  private fun loop() {
    var previousRid = ""
    var previousCount = 0
    var previousCall = ""
    var backoff = 5000L
    while (running) {
      val cfg = config(this)
      if (cfg == null) { stopSelf(); return }
      if (!cfg.optBoolean("on", false)) {
        // Sveglia spenta: se il rumore è acceso il servizio resta vivo per quel thread.
        if (!cfg.optBoolean("chaff", false)) { stopSelf(); return }
        try { Thread.sleep(30000) } catch (e: InterruptedException) { return }
        continue
      }
      val rid = cfg.optString("rid", "")
      val base = cfg.optString("base", "https://49.12.242.0").trimEnd('/')
      if (rid.length < 32) { stopSelf(); return }
      if (rid != previousRid) {
        previousRid = rid
        previousCount = 0
        previousCall = ""
      }
      try {
        val url = URL("$base/api/public/wake/poll?rid=$rid&wait=25")
        val c = url.openConnection() as HttpURLConnection
        c.requestMethod = "GET"
        c.connectTimeout = 15000
        c.readTimeout = 40000
        c.setRequestProperty("Accept", "application/json")
        val code = c.responseCode
        if (code == 200) {
          val body = c.inputStream.bufferedReader().use { it.readText() }
          c.disconnect()
          backoff = 5000L
          val event = try { JSONObject(body) } catch (e: Exception) { JSONObject() }
          val n = event.optInt("n", 0)
          val incoming = event.optString("call", "").takeIf { it.matches(Regex("[a-f0-9]{32}")) }.orEmpty()
          val current = config(this)
          if (running && current?.optBoolean("on", false) == true && current.optString("rid") == rid) {
            if (incoming.isNotEmpty() && incoming != previousCall) notifyCall(incoming)
            if (incoming.isEmpty() && previousCall.isNotEmpty()) {
              getSystemService(NotificationManager::class.java).cancel(CALL_ID)
            }
            previousCall = incoming
            if (n > previousCount) notifyMessages(n)
            previousCount = n
          }
          // A nonzero count returns immediately even when it has not changed.
          if (n > 0 || incoming.isNotEmpty()) Thread.sleep(1000)
        } else {
          c.disconnect()
          // The configured token can be renewed while this connection is in flight.
          if (code == 404 && !wakeOn(this) && !chaffOn(this)) { stopSelf(); return }
          Thread.sleep(backoff)
          backoff = minOf(backoff * 2, 120000L)
        }
      } catch (e: Exception) {
        try { Thread.sleep(backoff) } catch (i: InterruptedException) { return }
        backoff = minOf(backoff * 2, 120000L)
      }
    }
  }

  // TRAFFICO DI RUMORE IN BACKGROUND.
  // Anche a schermo spento o con l'app chiusa, invia richieste finte (innocuo /api/health,
  // con lo stesso riempitivo casuale delle richieste vere) a intervalli casuali. Così chi
  // osserva la rete non distingue i momenti di silenzio da quelli in cui comunichi davvero.
  private fun randPad(): String {
    val cs = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
    val n = 24 + (Math.random() * 1200).toInt()
    val sb = StringBuilder(n)
    for (i in 0 until n) sb.append(cs[(Math.random() * cs.length).toInt()])
    return sb.toString()
  }

  // Intervallo casuale esponenziale (processo di Poisson), limitato tra 6 e 60 s: una
  // cadenza fissa sarebbe a sua volta un'impronta riconoscibile.
  private fun nextDelayMs(): Long {
    val u = Math.min(0.999999, Math.max(1e-6, Math.random()))
    val d = (-17000.0 * Math.log(1.0 - u)).toLong()
    return Math.min(60000L, Math.max(6000L, d))
  }

  private fun chaffLoop() {
    while (running) {
      try { Thread.sleep(nextDelayMs()) } catch (e: InterruptedException) { return }
      if (!running) return
      val cfg = config(this) ?: continue
      if (!cfg.optBoolean("chaff", false)) continue
      val base = cfg.optString("base", "https://49.12.242.0").trimEnd('/')
      try {
        val c = URL("$base/api/health").openConnection() as HttpURLConnection
        c.requestMethod = "GET"
        c.connectTimeout = 15000
        c.readTimeout = 15000
        c.setRequestProperty("X-Pad", randPad())
        c.responseCode
        c.inputStream.use { it.read() }
        c.disconnect()
      } catch (e: Exception) { /* il rumore non deve mai disturbare */ }
    }
  }

  override fun onTimeout(startId: Int, fgsType: Int) {
    stopSelf()
  }

  override fun onDestroy() {
    running = false
    worker?.interrupt()
    chaffWorker?.interrupt()
    super.onDestroy()
  }

  override fun onBind(intent: Intent?): IBinder? = null
}
