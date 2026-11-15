package com.ultron.messenger

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import javax.crypto.SecretKeyFactory
import org.bouncycastle.crypto.generators.Argon2BytesGenerator
import org.bouncycastle.crypto.params.Argon2Parameters
import java.util.concurrent.Executors
import javax.crypto.spec.PBEKeySpec

// DERIVAZIONE DEL PIN, IN CODICE NATIVO — v2.5.1
//
// Perche esiste questo file: nella v2.5.0 la derivazione era argon2id in JavaScript puro.
// Sul server (Node/V8) costava 634 ms. Sul telefono, con Hermes, e' un ordine di grandezza
// piu lenta, e il salvataggio del PIN faceva 7 derivazioni di fila sullo stesso thread che
// disegna lo schermo: la rotella girava e non finiva mai. Un KDF che blocca l'app vale
// zero, per robusto che sia sulla carta.
//
// Qui si usa PBKDF2-HMAC-SHA512 di Android (`SecretKeyFactory`): sta nella piattaforma, non
// aggiunge NESSUNA dipendenza, non tocca la build riproducibile, gira in codice nativo e i
// metodi dei moduli React Native girano fuori dal thread dell'interfaccia — quindi lo
// schermo resta vivo mentre lavora.
//
// COSA SI GUADAGNA E COSA SI PERDE, detto chiaro:
// · Prima (fino alla v2.3.3): UN solo sha512. Un PIN di 6 cifre = un milione di tentativi
//   in meno di un secondo su un portatile, se qualcuno estrae la memoria dell'app.
// · Adesso: 600.000 iterazioni di HMAC-SHA512. Lo stesso milione di tentativi costa
//   600.000 volte di piu.
// · PBKDF2 NON e' "memory-hard" come argon2id: una GPU e' piu efficiente su PBKDF2 che su
//   argon2. E' il prezzo pagato per avere un KDF che sul telefono funziona davvero.
//   Il vero limite resta la lunghezza del PIN: 6 cifre sono 6 cifre. Un PIN di 8-10 cifre
//   sposta la difesa molto piu in alto di qualunque scelta di KDF.
class KdfModule(private val ctx: ReactApplicationContext) : ReactContextBaseJavaModule(ctx) {

  override fun getName() = "LatticeKdf"

  @ReactMethod
  fun available(promise: Promise) {
    promise.resolve(try { SecretKeyFactory.getInstance(ALGO); true } catch (e: Throwable) { false })
  }

  /// Restituisce 64 byte in esadecimale. Chi chiama prende i primi 32 come chiave.
  /// Il PIN non viene mai registrato, ne messo in un log, ne restituito.
  @ReactMethod
  fun derive(pin: String, salt: String, iterations: Int, promise: Promise) {
    try {
      val it = if (iterations < 10000) 10000 else iterations
      val spec = PBEKeySpec(pin.toCharArray(), salt.toByteArray(Charsets.UTF_8), it, 512)
      val out = SecretKeyFactory.getInstance(ALGO).generateSecret(spec).encoded
      spec.clearPassword()
      val sb = StringBuilder(out.size * 2)
      for (b in out) sb.append(String.format("%02x", b))
      // La copia in chiaro della chiave derivata viene azzerata subito: resta solo la
      // stringa che stiamo per consegnare al JS.
      java.util.Arrays.fill(out, 0)
      promise.resolve(sb.toString())
    } catch (e: Throwable) {
      promise.reject("kdf_failed", e.message ?: "derivazione non riuscita")
    }
  }

  /// Quanto costa DAVVERO su QUESTO telefono. Serve alla diagnostica in-app: i numeri
  /// misurati valgono piu di una promessa scritta in un README.
  @ReactMethod
  fun bench(iterations: Int, promise: Promise) {
    try {
      val t0 = System.currentTimeMillis()
      val spec = PBEKeySpec("000000".toCharArray(), "bench".toByteArray(Charsets.UTF_8), iterations, 512)
      SecretKeyFactory.getInstance(ALGO).generateSecret(spec)
      spec.clearPassword()
      promise.resolve((System.currentTimeMillis() - t0).toInt())
    } catch (e: Throwable) { promise.resolve(-1) }
  }

  private val exportWorker = Executors.newSingleThreadExecutor()

  @ReactMethod
  fun deriveExportKey(secretHex: String, saltHex: String, promise: Promise) {
    if (secretHex.length > 2048 || secretHex.length % 2 != 0 ||
        !secretHex.matches(Regex("[0-9a-f]*")) || !saltHex.matches(Regex("[0-9a-f]{32}"))) {
      promise.reject("export_kdf_input", "Invalid derivation input")
      return
    }
    exportWorker.execute {
      val secret = secretHex.chunked(2).map { it.toInt(16).toByte() }.toByteArray()
      val salt = saltHex.chunked(2).map { it.toInt(16).toByte() }.toByteArray()
      val out = ByteArray(32)
      try {
        val config = Argon2Parameters.Builder(Argon2Parameters.ARGON2_id)
          .withVersion(Argon2Parameters.ARGON2_VERSION_13)
          .withMemoryAsKB(65536).withIterations(3).withParallelism(1).withSalt(salt)
          .build()
        Argon2BytesGenerator().apply { init(config); generateBytes(secret, out) }
        promise.resolve(out.joinToString("") { "%02x".format(it.toInt() and 255) })
      } catch (e: Throwable) {
        promise.reject("export_kdf_failed", "Key derivation failed")
      } finally {
        secret.fill(0)
        out.fill(0)
      }
    }
  }

  companion object { private const val ALGO = "PBKDF2WithHmacSHA512" }
}
