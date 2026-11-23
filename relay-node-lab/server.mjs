import https from "node:https";
import { createHash, createPublicKey, sign, verify } from "node:crypto";

const PROTOCOL = "unvor-relay-lab/1";
const MAX_BODY = 256 * 1024;
const MAX_TTL_MS = 60_000;
const CLOCK_SKEW_MS = 30_000;
const REPLAY_TTL_MS = 120_000;
const REPLAY_CAP = 10_000;

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const toB64 = (value) => Buffer.from(value).toString("base64");
const fromB64 = (value) => Buffer.from(value, "base64");
export function nodeIdFor(publicKeyPem) {
  const der = createPublicKey(publicKeyPem).export({ type: "spki", format: "der" });
  return sha256(der);
}

export function envelopeMessage(envelope) {
  return [
    "UNVOR-MESSAGE-V1",
    envelope.messageId,
    envelope.destinationNodeId,
    String(envelope.issuedAt),
    String(envelope.expiresAt),
    sha256(fromB64(envelope.payloadB64)),
  ].join("\n");
}

export function signEnvelope(fields, privateKeyPem) {
  const envelope = { ...fields };
  envelope.signature = toB64(sign(null, Buffer.from(envelopeMessage(envelope)), privateKeyPem));
  return envelope;
}

function nodeRequestMessage(method, pathname, timestamp, nonce, body) {
  return ["UNVOR-NODE-HOP-V1", method, pathname, timestamp, nonce, sha256(body)].join("\n");
}

function nodeResponseMessage(status, timestamp, nonce, body) {
  return ["UNVOR-NODE-ACK-V1", String(status), timestamp, nonce, sha256(body)].join("\n");
}

function writeJson(res, status, body, signer) {
  const bytes = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": bytes.length,
    "cache-control": "no-store, max-age=0",
    pragma: "no-cache",
    "x-content-type-options": "nosniff",
    ...(signer ? signer(bytes, status) : {}),
  });
  res.end(bytes);
}

async function readBody(req) {
  if (Number(req.headers["content-length"] || 0) > MAX_BODY) throw httpError(413, "request too large");
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw httpError(413, "request too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function parseJson(body) {
  try { return JSON.parse(body.toString("utf8")); }
  catch { throw httpError(400, "invalid JSON"); }
}

function validateEnvelope(envelope, destinationId) {
  if (!envelope || typeof envelope !== "object") throw httpError(400, "invalid envelope");
  if (!/^[0-9a-f]{32}$/.test(envelope.messageId || "")) throw httpError(400, "invalid message id");
  if (!/^[0-9a-f]{64}$/.test(envelope.destinationNodeId || "")) throw httpError(400, "invalid destination");
  if (envelope.destinationNodeId !== destinationId) throw httpError(404, "destination node not reached");
  if (!Number.isSafeInteger(envelope.issuedAt) || !Number.isSafeInteger(envelope.expiresAt)) throw httpError(400, "invalid time bounds");
  const now = Date.now();
  if (envelope.issuedAt > now + CLOCK_SKEW_MS || envelope.issuedAt < now - MAX_TTL_MS - CLOCK_SKEW_MS) throw httpError(408, "stale envelope");
  if (envelope.expiresAt < now || envelope.expiresAt <= envelope.issuedAt || envelope.expiresAt - envelope.issuedAt > MAX_TTL_MS) throw httpError(408, "expired envelope");
  if (typeof envelope.payloadB64 !== "string" || envelope.payloadB64.length > MAX_BODY * 2 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(envelope.payloadB64)) throw httpError(400, "invalid payload");
  if (typeof envelope.senderPublicKeyPem !== "string" || envelope.senderPublicKeyPem.length > 4096) throw httpError(400, "invalid sender key");
  if (typeof envelope.signature !== "string") throw httpError(400, "missing sender signature");
  let valid = false;
  try { valid = verify(null, Buffer.from(envelopeMessage(envelope)), envelope.senderPublicKeyPem, fromB64(envelope.signature)); }
  catch { valid = false; }
  if (!valid) throw httpError(401, "invalid sender signature");
  return { payloadHash: sha256(fromB64(envelope.payloadB64)) };
}

function makeNodeAuth(privateKeyPem, method, pathname, body) {
  const timestamp = String(Date.now());
  const nonce = Buffer.from(cryptoRandom(18)).toString("base64url");
  const message = nodeRequestMessage(method, pathname, timestamp, nonce, body);
  return {
    "x-unvor-node-time": timestamp,
    "x-unvor-node-nonce": nonce,
    "x-unvor-node-signature": toB64(sign(null, Buffer.from(message), privateKeyPem)),
  };
}

function cryptoRandom(size) {
  // Kept as a small wrapper so the service has no non-runtime dependencies.
  return globalThis.crypto.getRandomValues(new Uint8Array(size));
}

function verifyNodeAuth(req, peer, body, replay) {
  const timestamp = req.headers["x-unvor-node-time"];
  const nonce = req.headers["x-unvor-node-nonce"];
  const signature = req.headers["x-unvor-node-signature"];
  if (typeof timestamp !== "string" || typeof nonce !== "string" || typeof signature !== "string") return false;
  const ts = Number(timestamp);
  if (!Number.isSafeInteger(ts) || Math.abs(Date.now() - ts) > CLOCK_SKEW_MS) return false;
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(nonce)) return false;
  const replayKey = `${peer.id}:${nonce}`;
  if (replay.has(replayKey)) return false;
  const message = nodeRequestMessage(req.method, new URL(req.url, "https://relay.invalid").pathname, timestamp, nonce, body);
  let ok = false;
  try { ok = verify(null, Buffer.from(message), peer.publicKeyPem, fromB64(signature)); }
  catch { ok = false; }
  if (ok) replay.set(replayKey, Date.now() + REPLAY_TTL_MS);
  return ok;
}

function signedHeaders(nodeId, privateKeyPem, status, body) {
  const timestamp = String(Date.now());
  const nonce = Buffer.from(cryptoRandom(18)).toString("base64url");
  const message = nodeResponseMessage(status, timestamp, nonce, body);
  return {
    "x-unvor-node-id": nodeId,
    "x-unvor-ack-time": timestamp,
    "x-unvor-ack-nonce": nonce,
    "x-unvor-ack-signature": toB64(sign(null, Buffer.from(message), privateKeyPem)),
  };
}

function verifySignedResponse(response, peer, body) {
  const timestamp = response.headers["x-unvor-ack-time"];
  const nonce = response.headers["x-unvor-ack-nonce"];
  const signature = response.headers["x-unvor-ack-signature"];
  if (response.headers["x-unvor-node-id"] !== peer.id || typeof timestamp !== "string" || typeof nonce !== "string" || typeof signature !== "string") return false;
  if (Math.abs(Date.now() - Number(timestamp)) > CLOCK_SKEW_MS) return false;
  const message = nodeResponseMessage(response.statusCode, timestamp, nonce, body);
  try { return verify(null, Buffer.from(message), peer.publicKeyPem, fromB64(signature)); }
  catch { return false; }
}

function postPeer(peer, body, authHeaders, timeoutMs) {
  const target = new URL("/v1/relay", peer.url);
  if (target.protocol !== "https:") throw httpError(502, "peer must use HTTPS");
  return new Promise((resolve, reject) => {
    const req = https.request(target, {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": body.length, ...authHeaders },
      agent: new https.Agent({ ca: peer.caPem, keepAlive: false, maxSockets: 4 }),
      timeout: timeoutMs,
    }, (res) => {
      const chunks = [];
      let size = 0;
      res.on("data", (chunk) => {
        size += chunk.length;
        if (size > 16 * 1024) { req.destroy(httpError(502, "peer response too large")); return; }
        chunks.push(chunk);
      });
      res.on("end", () => {
        const responseBody = Buffer.concat(chunks);
        if (!verifySignedResponse(res, peer, responseBody)) return reject(httpError(502, "peer acknowledgement signature invalid"));
        if (res.statusCode !== 200) return reject(httpError(502, "peer did not accept packet"));
        try { resolve(JSON.parse(responseBody.toString("utf8"))); }
        catch { reject(httpError(502, "invalid peer acknowledgement")); }
      });
    });
    req.on("timeout", () => req.destroy(httpError(504, "peer timeout")));
    req.on("error", reject);
    req.end(body);
  });
}

function sweepMap(map, now = Date.now()) {
  for (const [key, expiresAt] of map) if (expiresAt <= now) map.delete(key);
  while (map.size > REPLAY_CAP) map.delete(map.keys().next().value);
}

export function createRelayServer({ nodeId, privateKeyPem, peers = [], tls, timeoutMs = 5000 }) {
  if (!/^[0-9a-f]{64}$/.test(nodeId || "")) throw new Error("nodeId must be a 64-character hex id");
  if (typeof privateKeyPem !== "string" || !privateKeyPem.includes("PRIVATE KEY")) throw new Error("node private key is required");
  if (nodeIdFor(createPublicKey(privateKeyPem).export({ type: "spki", format: "pem" })) !== nodeId) throw new Error("node id does not match its private key");
  if (!tls?.key || !tls?.cert) throw new Error("TLS key and certificate are required");
  const peerMap = new Map(peers.map((peer) => [peer.id, peer]));
  const replay = new Map();

  const server = https.createServer({ key: tls.key, cert: tls.cert, minVersion: "TLSv1.2" }, async (req, res) => {
    if (req.method === "GET" && req.url === "/health") {
      return writeJson(res, 200, { ok: true, protocol: PROTOCOL, nodeId });
    }
    if (req.method !== "POST" || req.url !== "/v1/relay") return writeJson(res, 404, { error: "not found" });
    let body = Buffer.alloc(0);
    try {
      body = await readBody(req);
      const input = parseJson(body);
      const envelope = input?.envelope;
      const { payloadHash } = validateEnvelope(envelope, envelope?.destinationNodeId);
      if (input?.destinationNodeId !== envelope.destinationNodeId) throw httpError(400, "route mismatch");

      const fromNodeId = req.headers["x-unvor-node-id"];
      if (fromNodeId !== undefined) {
        const peer = peerMap.get(String(fromNodeId));
        if (!peer || !verifyNodeAuth(req, peer, body, replay)) throw httpError(401, "untrusted peer");
      }

      sweepMap(replay);
      if (envelope.destinationNodeId === nodeId) {
        const ack = { ok: true, protocol: PROTOCOL, nodeId, messageId: envelope.messageId, payloadHash };
        return writeJson(res, 200, ack, (bytes, status) => signedHeaders(nodeId, privateKeyPem, status, bytes));
      }

      const peer = peerMap.get(envelope.destinationNodeId);
      if (!peer) throw httpError(404, "destination peer unavailable");
      const outbound = Buffer.from(JSON.stringify({ destinationNodeId: envelope.destinationNodeId, envelope }));
      const auth = makeNodeAuth(privateKeyPem, "POST", "/v1/relay", outbound);
      const ack = await postPeer(peer, outbound, { "x-unvor-node-id": nodeId, ...auth }, timeoutMs);
      if (ack.nodeId !== peer.id || ack.messageId !== envelope.messageId || ack.payloadHash !== payloadHash) throw httpError(502, "peer receipt does not match packet");
      const response = { ok: true, protocol: PROTOCOL, nodeId, messageId: envelope.messageId, payloadHash, destinationNodeId: ack.nodeId };
      return writeJson(res, 200, response, (bytes, status) => signedHeaders(nodeId, privateKeyPem, status, bytes));
    } catch (error) {
      const status = Number.isInteger(error?.status) ? error.status : 502;
      // Never print request bodies, message ids, peer addresses, or client IPs.
      return writeJson(res, status, { error: status < 500 ? error.message : "relay unavailable" }, (bytes, code) => signedHeaders(nodeId, privateKeyPem, code, bytes));
    } finally {
      // Drop our reference to the body as soon as the request completes.
      body = Buffer.alloc(0);
    }
  });
  return server;
}

