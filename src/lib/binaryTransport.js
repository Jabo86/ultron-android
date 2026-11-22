// Native upload is registered by App; Node cryptographic checks keep their normal HTTP adapter.
let nativeUploader = null;
export function setNativeBinaryUploader(upload) { nativeUploader = upload; }
export async function postEncryptedBytes(transport, path, bytes, options) {
  if (!(bytes instanceof Uint8Array) || !bytes.length) throw new Error("Blocco cifrato vuoto o non valido.");
  if (nativeUploader) return nativeUploader(transport.getUri({ url: path, params: options.params }), bytes, options);
  return transport.post(path, bytes.slice().buffer, { ...options, adapter: "xhr" });
}

export function createCipherUploader(fs, encode, randomId) {
  return async (url, bytes, options = {}) => {
    if (options.signal?.aborted) throw Object.assign(new Error("Trasferimento annullato."), { name: "AbortError" });
    if (!fs.cacheDirectory) throw new Error("Memoria temporanea dell’app non disponibile.");
    const path = fs.cacheDirectory + "ultron-transfer-" + randomId() + ".cipher";
    let task, timeout, timedOut = false;
    const cancel = () => { task?.cancelAsync().catch(() => {}); };
    try {
      // This private temporary file contains only already-encrypted bytes, never the source file.
      await fs.writeAsStringAsync(path, encode(bytes), { encoding: fs.EncodingType.Base64 });
      if (options.signal?.aborted) throw Object.assign(new Error("Trasferimento annullato."), { name: "AbortError" });
      task = fs.createUploadTask(url, path, {
        httpMethod: "POST", uploadType: fs.FileSystemUploadType.BINARY_CONTENT,
        headers: options.headers,
      }, progress => options.onUploadProgress?.({ loaded: progress.totalBytesSent, total: progress.totalBytesExpectedToSend }));
      options.signal?.addEventListener("abort", cancel, { once: true });
      if (options.signal?.aborted) throw Object.assign(new Error("Trasferimento annullato."), { name: "AbortError" });
      if (options.timeout) timeout = setTimeout(() => { timedOut = true; cancel(); }, options.timeout);
      const result = await task.uploadAsync();
      if (options.signal?.aborted) throw Object.assign(new Error("Trasferimento annullato."), { name: "AbortError" });
      if (timedOut) throw new Error("Tempo massimo del trasferimento superato.");
      if (!result) throw new Error("Il sistema ha interrotto il trasferimento.");
      let data = result.body;
      try { data = JSON.parse(result.body); } catch { /* Preserve non-JSON HTTP failures. */ }
      if (result.status < 200 || result.status >= 300) {
        throw Object.assign(new Error(`Il gateway ha rifiutato il trasferimento (HTTP ${result.status}).`), { response: { status: result.status, data } });
      }
      return { data, status: result.status, headers: result.headers };
    } catch (error) {
      // Expo removes progress listeners on success; cancel also releases them after failure.
      await task?.cancelAsync().catch(() => {});
      if (options.signal?.aborted) throw Object.assign(new Error("Trasferimento annullato."), { name: "AbortError" });
      if (timedOut) throw new Error("Tempo massimo del trasferimento superato.");
      throw error;
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", cancel);
      await fs.deleteAsync(path, { idempotent: true }).catch(() => {});
    }
  };
}
