package com.ultron.messenger

import android.app.Activity
import android.app.KeyguardManager
import android.content.Intent
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.RippleDrawable
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.Button
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import java.util.Locale

/** An incoming alert can appear above the keyguard without exposing the React app. */
class IncomingCallActivity : Activity() {
    private val handler = Handler(Looper.getMainLooper())
    private var rid = ""
    private var answering = false
    private val surface = Color.rgb(0, 16, 25)
    private val border = Color.rgb(21, 82, 104)
    private val ink = Color.rgb(239, 252, 255)
    private val muted = Color.rgb(168, 214, 228)
    private val accent = Color.rgb(33, 223, 255)

    private val bodyFont by lazy {
        runCatching { Typeface.createFromAsset(assets, "fonts/UltronBody.ttf") }.getOrDefault(Typeface.DEFAULT)
    }
    private val displayFont by lazy {
        runCatching { Typeface.createFromAsset(assets, "fonts/UltronDisplay.ttf") }.getOrDefault(Typeface.DEFAULT_BOLD)
    }

    private fun dp(value: Int) = (resources.displayMetrics.density * value + 0.5f).toInt()

    private fun panel(color: Int, radius: Int, outline: Int? = null) = GradientDrawable().apply {
        setColor(color)
        cornerRadius = dp(radius).toFloat()
        if (outline != null) setStroke(dp(1), outline)
    }

    private fun button(label: String, primary: Boolean, action: () -> Unit) = Button(this).apply {
        text = label
        setAllCaps(false)
        textSize = 16f
        typeface = Typeface.create(bodyFont, Typeface.BOLD)
        setTextColor(if (primary) Color.BLACK else ink)
        minHeight = dp(56)
        setPadding(dp(16), dp(12), dp(16), dp(12))
        backgroundTintList = null
        background = RippleDrawable(
            ColorStateList.valueOf(if (primary) 0x26000000 else 0x2421DFFF),
            panel(if (primary) accent else surface, 16, if (primary) null else border),
            null
        )
        setOnClickListener { action() }
    }
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
            setPadding(dp(24), dp(58), dp(24), dp(58))
        }
        val cardWidth = minOf(dp(420), (resources.displayMetrics.widthPixels - dp(48)).coerceAtLeast(1))
        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(dp(22), dp(12), dp(22), dp(24))
            background = panel(surface, 28, border)
        }
        val logo = ImageView(this).apply {
            setImageResource(R.drawable.splashscreen_logo)
            scaleType = ImageView.ScaleType.FIT_CENTER
            importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
        }
        val heading = TextView(this).apply {
            text = "ULTRON"
            textSize = 15f
            letterSpacing = 0.18f
            typeface = displayFont
            setTextColor(accent)
            gravity = Gravity.CENTER
        }
        val title = TextView(this).apply {
            text = if (italian) "Chiamata in arrivo" else "Incoming call"
            textSize = 28f
            typeface = displayFont
            setTextColor(ink)
            gravity = Gravity.CENTER
        }
        val status = TextView(this).apply {
            text = if (italian) "Accedi all’app per rispondere o chiudi l’avviso." else "Open the app to answer, or dismiss this alert."
            textSize = 15f
            typeface = bodyFont
            setTextColor(muted)
            gravity = Gravity.CENTER
            accessibilityLiveRegion = View.ACCESSIBILITY_LIVE_REGION_POLITE
        }
        fun row(top: Int) = LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT
        ).apply { topMargin = dp(top) }
        card.addView(logo, LinearLayout.LayoutParams(dp(145), dp(145)))
        card.addView(heading, row(0))
        card.addView(title, row(10))
        card.addView(status, row(10))
        card.addView(button(if (italian) "Accedi per rispondere" else "Open to answer", true) {
            answer(status, italian)
        }, row(25))
        card.addView(button(if (italian) "Chiudi avviso" else "Dismiss alert", false) { finish() }, row(10))
        pane.addView(card, LinearLayout.LayoutParams(cardWidth, LinearLayout.LayoutParams.WRAP_CONTENT))
        setContentView(ScrollView(this).apply {
            isFillViewport = true
            setBackgroundColor(Color.BLACK)
            addView(pane)
        })
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
