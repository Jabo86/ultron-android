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
  private fun encodedHex(bytes: ByteArray): String {
    val alphabet = "0123456789abcdef"
    val result = CharArray(bytes.size*2)
    for (i in bytes.indices) { val value = bytes[i].toInt() and 255; result[i*2]=alphabet[value ushr 4]; result[i*2+1]=alphabet[value and 15] }
    return String(result)
  }
  @ReactMethod
  fun signMLDSA(data: String, key: String, promise: Promise) {
    worker.execute {
      var secret: ByteArray? = null
      var parameters: org.bouncycastle.crypto.params.MLDSAPrivateKeyParameters? = null
      try {
        require(data.length <= 1500000)
        secret = hex(key,4032)
        parameters = org.bouncycastle.crypto.params.MLDSAPrivateKeyParameters(org.bouncycastle.crypto.params.MLDSAParameters.ml_dsa_65,secret)
        val signer = org.bouncycastle.crypto.signers.MLDSASigner()
        signer.init(true,org.bouncycastle.crypto.params.ParametersWithRandom(parameters,java.security.SecureRandom()))
        val bytes = Base64.decode(data,Base64.NO_WRAP)
        signer.update(bytes,0,bytes.size)
        promise.resolve(encodedHex(signer.generateSignature()))
      } catch(e: Exception) { promise.reject("MESSAGE_SIGN", "Firma del messaggio non riuscita.", e) }
      finally { parameters?.destroy(); secret?.fill(0) }
    }
  }
  @ReactMethod
  fun verifyMLDSA(data: String, signature: String, publicKey: String, promise: Promise) {
    worker.execute {
      try {
        require(data.length <= 1500000)
        val signer = org.bouncycastle.crypto.signers.MLDSASigner()
        signer.init(false,org.bouncycastle.crypto.params.MLDSAPublicKeyParameters(org.bouncycastle.crypto.params.MLDSAParameters.ml_dsa_65,hex(publicKey,1952)))
        val bytes = Base64.decode(data,Base64.NO_WRAP)
        signer.update(bytes,0,bytes.size)
        promise.resolve(signer.verifySignature(hex(signature,3309)))
      } catch(e: Exception) { promise.resolve(false) }
    }
  }
  override fun invalidate() { worker.shutdown(); super.invalidate() }
}
