package com.unvor.globalrelay

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.ByteArrayOutputStream
import java.net.URL
import java.security.MessageDigest
import java.security.SecureRandom
import java.security.cert.X509Certificate
import javax.net.ssl.HttpsURLConnection
import javax.net.ssl.SSLContext
import javax.net.ssl.X509TrustManager

/** HTTPS client for explicitly imported relay certificates.
 * It accepts only the exact SHA-256 fingerprint saved in the public node profile.
 * No global trust store or certificate-validation bypass is installed.
 */
class GlobalRelayHttpModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("GlobalRelayHttp")

    AsyncFunction("request") { urlText: String, methodText: String, fingerprint: String,
                                headers: Map<String, String>, body: String? ->
      pinnedRequest(urlText, methodText, fingerprint, headers, body)
    }
  }

  private fun pinnedRequest(
    urlText: String,
    methodText: String,
    fingerprint: String,
    headers: Map<String, String>,
    bodyText: String?
  ): Map<String, Any?> {
    val url = URL(urlText)
    require(url.protocol.equals("https", ignoreCase = true) && url.userInfo == null && url.ref == null) {
      "Il relay deve usare un URL HTTPS valido."
    }
    val method = methodText.uppercase()
    require(method == "GET" || method == "POST") { "Metodo HTTP non consentito." }
    val expectedPin = fingerprint.replace(":", "").lowercase()
    require(expectedPin.matches(Regex("^[0-9a-f]{64}$"))) { "Impronta TLS non valida." }
    val body = bodyText?.toByteArray(Charsets.UTF_8)
    require(body == null || body.size <= 256 * 1024) { "Richiesta relay troppo grande." }

    val trust = object : X509TrustManager {
      override fun getAcceptedIssuers(): Array<X509Certificate> = emptyArray()

      override fun checkClientTrusted(chain: Array<out X509Certificate>?, authType: String?) {
        throw java.security.cert.CertificateException("Certificato client non previsto.")
      }

      override fun checkServerTrusted(chain: Array<out X509Certificate>?, authType: String?) {
        val leaf = chain?.firstOrNull()
          ?: throw java.security.cert.CertificateException("Il relay non ha presentato un certificato.")
        leaf.checkValidity()
        val actualPin = MessageDigest.getInstance("SHA-256").digest(leaf.encoded)
          .joinToString("") { byte -> "%02x".format(byte) }
        if (!MessageDigest.isEqual(actualPin.toByteArray(Charsets.US_ASCII), expectedPin.toByteArray(Charsets.US_ASCII))) {
          throw java.security.cert.CertificateException("Impronta TLS del relay diversa da quella importata.")
        }
      }
    }

    val ssl = SSLContext.getInstance("TLS")
    ssl.init(null, arrayOf(trust), SecureRandom())
    val connection = (url.openConnection() as? HttpsURLConnection)
      ?: throw IllegalArgumentException("Connessione HTTPS non disponibile.")
    connection.sslSocketFactory = ssl.socketFactory
    connection.hostnameVerifier = HttpsURLConnection.getDefaultHostnameVerifier()
    connection.requestMethod = method
    connection.connectTimeout = 8_000
    connection.readTimeout = 25_000
    connection.instanceFollowRedirects = false
    connection.useCaches = false
    connection.setRequestProperty("Accept", "application/json")
    connection.setRequestProperty("Cache-Control", "no-store")
    for ((name, value) in headers) {
      require(name.matches(Regex("^[A-Za-z0-9-]{1,64}$")) && value.length <= 8192) { "Header relay non valido." }
      require(!name.equals("Host", true) && !name.equals("Content-Length", true) &&
        !name.equals("Connection", true) && !name.equals("Transfer-Encoding", true)) { "Header HTTP riservato." }
      connection.setRequestProperty(name, value)
    }
    if (body != null) {
      connection.doOutput = true
      connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")
      connection.setFixedLengthStreamingMode(body.size)
    }
    try {
      if (body != null) connection.outputStream.use { it.write(body) }
      val status = connection.responseCode
      val stream = if (status >= 400) connection.errorStream else connection.inputStream
      val response = if (stream == null) ByteArray(0) else stream.use { input ->
        val output = ByteArrayOutputStream()
        val buffer = ByteArray(4096)
        var total = 0
        while (true) {
          val count = input.read(buffer)
          if (count < 0) break
          total += count
          require(total <= 64 * 1024) { "Risposta relay troppo grande." }
          output.write(buffer, 0, count)
        }
        output.toByteArray()
      }
      return mapOf(
        "status" to status,
        "contentType" to (connection.contentType ?: ""),
        "body" to response.toString(Charsets.UTF_8)
      )
    } finally {
      connection.disconnect()
    }
  }
}
