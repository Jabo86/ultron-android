package com.ultron.messenger

import android.app.Activity
import android.app.KeyguardManager
import android.content.Intent
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import java.util.Locale

/** An incoming alert can appear above the keyguard without exposing the React app. */
class IncomingCallActivity : Activity() {
    private val handler = Handler(Looper.getMainLooper())
    private var rid = ""
    private var answering = false
    private val watch = object : Runnable {
        override fun run() {
            if (WakeService.isIncomingCall(rid)) handler.postDelayed(this, 500)
            else finish()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        if (Build.VERSION.SDK_INT >= 27) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
        } else {
            @Suppress("DEPRECATION")
            window.addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON)
        }
        showCall(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        showCall(intent)
    }

    private fun showCall(intent: Intent) {
        rid = intent.getStringExtra(WakeService.CALL_RID).orEmpty()
        if (!WakeService.isIncomingCall(rid)) { finish(); return }
        val italian = Locale.getDefault().language == "it"
        val pane = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(38, 38, 38, 38)
            setBackgroundColor(Color.rgb(9, 15, 27))
        }
        val heading = TextView(this).apply {
            text = "ULTRON"
            textSize = 34f
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER
        }
        val status = TextView(this).apply {
            text = if (italian) "Chiamata in arrivo" else "Incoming call"
            textSize = 20f
            setTextColor(Color.LTGRAY)
            gravity = Gravity.CENTER
            setPadding(0, 18, 0, 30)
        }
        pane.addView(heading)
        pane.addView(status)
        pane.addView(Button(this).apply {
            text = if (italian) "Rispondi" else "Answer"
            setOnClickListener { answer(status, italian) }
        })
        pane.addView(Button(this).apply {
            text = if (italian) "Chiudi avviso" else "Dismiss alert"
            setOnClickListener { finish() }
        })
        setContentView(pane)
    }

    private fun answer(status: TextView, italian: Boolean) {
        if (answering || !WakeService.isIncomingCall(rid)) return
        val target = rid
        val keyguard = getSystemService(KeyguardManager::class.java)
        fun open() {
            answering = false
            if (!WakeService.isIncomingCall(target) || rid != target || isFinishing) { finish(); return }
            startActivity(Intent(this, MainActivity::class.java).apply {
                addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
                putExtra(WakeService.CALL_RID, target)
                putExtra(WakeService.CALL_ANSWER, true)
            })
            finish()
        }
        if (!keyguard.isKeyguardLocked) {
            open()
        } else {
            status.text = if (italian) "Sblocca il telefono per rispondere" else "Unlock to answer"
            if (Build.VERSION.SDK_INT >= 26) {
                answering = true
                keyguard.requestDismissKeyguard(this, object : KeyguardManager.KeyguardDismissCallback() {
                    override fun onDismissSucceeded() = open()
                    override fun onDismissCancelled() { answering = false }
                    override fun onDismissError() { answering = false }
                })
            }
        }
    }

    override fun onStart() {
        super.onStart()
        handler.post(watch)
    }

    override fun onStop() {
        handler.removeCallbacks(watch)
        super.onStop()
    }
}
