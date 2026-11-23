package com.ultron.messenger

import android.util.Base64
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.util.concurrent.Executors
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

class AttachmentCryptoModule(ctx: ReactApplicationContext) : ReactContextBaseJavaModule(ctx) {
  private val worker = Executors.newSingleThreadExecutor()
  override fun getName() = "AttachmentCrypto"
  private fun hex(value: String, length: Int): ByteArray {
    require(value.length == length * 2 && value.matches(Regex("[0-9a-f]+")))
    return ByteArray(length) { value.substring(it*2,it*2+2).toInt(16).toByte() }
  }
  @ReactMethod
  fun crypt(data: String, key: String, iv: String, encrypt: Boolean, promise: Promise) {
    worker.execute {
      var secret: ByteArray? = null
      try {
        // One bounded attachment block; never allocate a whole 50 MB attachment.
        require(data.length <= 5592440)
        secret = hex(key,32)
        val input = Base64.decode(data,Base64.NO_WRAP)
        require(input.size <= 4*1024*1024+16)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(if(encrypt) Cipher.ENCRYPT_MODE else Cipher.DECRYPT_MODE,SecretKeySpec(secret,"AES"),GCMParameterSpec(128,hex(iv,12)))
        promise.resolve(Base64.encodeToString(cipher.doFinal(input),Base64.NO_WRAP))
      } catch (e: Exception) { promise.reject("ATTACHMENT_CRYPTO", "Cifratura o autenticazione dell’allegato fallita.", e) }
      finally { secret?.fill(0) }
    }
  }
  override fun invalidate() { worker.shutdown(); super.invalidate() }
}
