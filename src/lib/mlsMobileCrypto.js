// The MLS dependency uses this narrow WebCrypto surface on Hermes. Cryptographic
// operations are delegated to the same Noble primitives used elsewhere in ULTRON.
import { gcm } from "@noble/ciphers/aes.js";
import { equalBytes } from "@noble/ciphers/utils.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { hmac } from "@noble/hashes/hmac.js";
import { sha256, sha384, sha512 } from "@noble/hashes/sha2.js";

const name = value => typeof value === "string" ? value : value?.name;
const algorithmError = () => new Error("Algoritmo WebCrypto non supportato per MLS.");
const hashes = new Map([["SHA-256", sha256], ["SHA-384", sha384], ["SHA-512", sha512]]);
const hashFor = value => hashes.get(name(value));

function bufferSource(value) {
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  throw new TypeError("WebCrypto richiede un buffer binario.");
}

export function createMlsSubtleCrypto() {
  const material = new WeakMap();
  function keyFor(handle, algorithm, usage) {
    const key = material.get(handle);
    if (!key || key.algorithm !== algorithm || !key.usages.includes(usage)) throw algorithmError();
    return key;
  }
  function aes(params, handle, data, usage) {
    if (params?.name !== "AES-GCM" || (params.tagLength !== undefined && params.tagLength !== 128)) throw algorithmError();
    const iv = bufferSource(params.iv);
    if (iv.length !== 12) throw algorithmError();
    const key = keyFor(handle, "AES-GCM", usage);
    const aad = params.additionalData === undefined ? undefined : bufferSource(params.additionalData);
    const cipher = gcm(key.bytes, iv, aad);
    return cipher[usage](bufferSource(data)).buffer;
  }
  return {
    async digest(algorithm, data) {
      const hash = hashFor(algorithm);
      if (!hash) throw algorithmError();
      return hash(bufferSource(data)).buffer;
    },
    async importKey(format, input, algorithm, extractable, usages) {
      const kind = name(algorithm);
      if (format !== "raw" || (extractable && kind !== "AES-GCM") || !Array.isArray(usages) || !usages.length) throw algorithmError();
      const bytes = bufferSource(input);
      const hash = hashFor(algorithm?.hash);
      const allowed = kind === "AES-GCM" && [16, 32].includes(bytes.length) ? ["encrypt", "decrypt"]
        : kind === "HMAC" && hash && bytes.length && (algorithm.length === undefined || algorithm.length === bytes.length * 8) ? ["sign", "verify"]
        : kind === "HKDF" ? ["deriveBits"] : [];
      if (usages.some(usage => !allowed.includes(usage))) throw algorithmError();
      const handle = Object.freeze({ type: "secret", extractable: false });
      material.set(handle, { bytes: bytes.slice(), algorithm: kind, hash, usages: [...usages] });
      return handle;
    },
    async sign(algorithm, handle, data) {
      if (name(algorithm) !== "HMAC") throw algorithmError();
      const key = keyFor(handle, "HMAC", "sign");
      return hmac(key.hash, key.bytes, bufferSource(data)).buffer;
    },
    async verify(algorithm, handle, signature, data) {
      if (name(algorithm) !== "HMAC") throw algorithmError();
      const key = keyFor(handle, "HMAC", "verify");
      return equalBytes(hmac(key.hash, key.bytes, bufferSource(data)), bufferSource(signature));
    },
    async deriveBits(params, handle, length) {
      const hash = hashFor(params?.hash);
      if (params?.name !== "HKDF" || !hash || !Number.isSafeInteger(length) || length <= 0 || length % 8 !== 0) throw algorithmError();
      const key = keyFor(handle, "HKDF", "deriveBits");
      return hkdf(hash, key.bytes, bufferSource(params.salt), bufferSource(params.info), length / 8).buffer;
    },
    async encrypt(params, handle, data) { return aes(params, handle, data, "encrypt"); },
    async decrypt(params, handle, data) { return aes(params, handle, data, "decrypt"); },
  };
}
