// Client for the isolated ULTRON relay. Registration supplies a per-installation
// token and an asynchronous signer. Message encryption belongs to the caller.
import { sha256 } from "@noble/hashes/sha2.js";
import { base64ToBytes, bytesToBase64, hexToBytes, utf8Encode, verifyMessage } from "./crypto.js";

const hex32 = /^[0-9a-f]{32}$/;
const hex64 = /^[0-9a-f]{64}$/;
const signaturePattern = /^[0-9a-f]{6618}$/;
const requestContext = utf8Encode("ULTRON relay request v1");

export function relayPacketDigest(ciphertext) {
  if (typeof ciphertext !== "string" || ciphertext.length > 43724 || !/^[A-Za-z0-9+/]+={0,2}$/.test(ciphertext)) {
    throw new Error("Busta del relay non valida.");
  }
  const bytes = base64ToBytes(ciphertext);
  if (!bytes.length || bytes.length > 32 * 1024 || bytesToBase64(bytes) !== ciphertext) {
    throw new Error("Busta del relay non valida.");
  }
  return Array.from(sha256(bytes), byte => byte.toString(16).padStart(2, "0")).join("");
}

export function relayReceiptPayload(sender, recipient, messageId, digest) {
  if (![sender, recipient, messageId].every(value => typeof value === "string" && hex32.test(value)) ||
      typeof digest !== "string" || !hex64.test(digest)) throw new Error("Conferma del relay non valida.");
  return JSON.stringify(["ultron-relay-receipt-v1", sender, recipient, messageId, digest]);
}

export function verifyRelayReceipt(record, signature) {
  return typeof signature === "string" && signaturePattern.test(signature) &&
    verifyMessage(relayReceiptPayload(record.sender, record.recipient, record.id, record.digest),
      signature, record.recipientKey);
}

export function createVolatileRelayTransport({ origin, token, sign, request = fetch, timeoutMs = 6000, loopback = false }) {
  const allowed = /^https:\/\/[^/?#@\s]+$/.test(origin) ||
    (loopback && /^http:\/\/127\.0\.0\.1:\d+$/.test(origin));
  if (!allowed || typeof token !== "string" || !hex64.test(token) || typeof sign !== "function") {
    throw new Error("Configurazione del relay non valida.");
  }
  const tokenDigest = sha256(hexToBytes(token));
  let pending = Promise.resolve();

  async function http(method, path, body, proof, signal) {
    if (signal?.aborted) throw new Error("Sessione relay chiusa.");
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(abort, timeoutMs);
    const headers = { Authorization: "Bearer " + token, Accept: "application/json", ...proof };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    try {
      const reply = await request(origin + path, { method, headers, body, signal: controller.signal, redirect: "error" });
      if (!reply.ok) throw Object.assign(new Error("Richiesta relay rifiutata."), { status: reply.status });
      return await reply.json();
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    }
  }

  function exchange(method, path, data, signal) {
    const exchangeTurn = pending.then(async () => {
      const body = data === undefined ? undefined : JSON.stringify(data);
      const challenge = await http("POST", "/v1/proof/challenge", "{}", undefined, signal);
      if (!hex64.test(challenge?.nonce || "")) throw new Error("Sfida relay non valida.");
      const verbAndPath = utf8Encode(method + "\0" + path + "\0");
      const transcript = new Uint8Array(96 + verbAndPath.length);
      transcript.set(hexToBytes(challenge.nonce));
      transcript.set(tokenDigest, 32);
      transcript.set(verbAndPath, 64);
      transcript.set(sha256(utf8Encode(body ?? "")), 64 + verbAndPath.length);
      const signature = await sign(transcript, requestContext);
      if (!(signature instanceof Uint8Array) || signature.length !== 3309) throw new Error("Firma relay non valida.");
      return http(method, path, body, {
        "X-Ultron-Nonce": challenge.nonce, "X-Ultron-Proof": bytesToBase64(signature),
      }, signal);
    });
    pending = exchangeTurn.catch(() => {});
    return exchangeTurn;
  }

  return {
    async send({ id, recipient, ciphertext }, signal) {
      if (!hex32.test(id) || !hex32.test(recipient)) throw new Error("Destinazione relay non valida.");
      const reply = await exchange("POST", "/v1/messages", { recipient, message_id: id, ciphertext }, signal);
      if (reply?.message_id !== id) throw new Error("Ricezione del relay non valida.");
    },
    inbox: signal => exchange("GET", "/v1/inbox", undefined, signal),
    acknowledge: ({ sender, id }, signal) => {
      if (!hex32.test(sender) || !hex32.test(id)) throw new Error("Conferma del relay non valida.");
      return exchange("POST", "/v1/ack", { sender, message_id: id }, signal);
    },
  };
}
