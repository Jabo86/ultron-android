import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, createHash, verify, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import https from "node:https";
import { createRelayServer, nodeIdFor, signEnvelope } from "../server.mjs";

const digest = (v) => createHash("sha256").update(v).digest("hex");
const b64 = (v) => Buffer.from(v).toString("base64");

function keypair() {
  return generateKeyPairSync("ed25519", {
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
}

async function start(server) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `https://127.0.0.1:${server.address().port}`;
}

function post(url, body, ca) {
  const bytes = Buffer.from(JSON.stringify(body));
  return new Promise((resolve, reject) => {
    const req = https.request(new URL("/v1/relay", url), {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": bytes.length },
      agent: new https.Agent({ ca }),
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on("error", reject);
    req.end(bytes);
  });
}

function verifyAck(response, publicKeyPem) {
  const timestamp = response.headers["x-unvor-ack-time"];
  const nonce = response.headers["x-unvor-ack-nonce"];
  const signature = response.headers["x-unvor-ack-signature"];
  const text = ["UNVOR-NODE-ACK-V1", String(response.status), timestamp, nonce, digest(response.body)].join("\n");
  return verify(null, Buffer.from(text), publicKeyPem, Buffer.from(signature, "base64"));
}

test("two independent relay nodes forward an opaque signed envelope live over pinned TLS", async (t) => {
  const work = mkdtempSync(join(tmpdir(), "unvor-relay-lab-"));
  t.after(() => rmSync(work, { recursive: true, force: true }));
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", join(work, "tls.key"), "-out", join(work, "tls.crt"), "-subj", "/CN=localhost", "-addext", "subjectAltName=IP:127.0.0.1,DNS:localhost", "-days", "1"], { stdio: "ignore" });
  const cert = readFileSync(join(work, "tls.crt"), "utf8");
  const tlsKey = readFileSync(join(work, "tls.key"), "utf8");
  const a = keypair();
  const b = keypair();
  const sender = keypair();
  const idA = nodeIdFor(a.publicKey);
  const idB = nodeIdFor(b.publicKey);
  let urlB;
  const nodeB = createRelayServer({ nodeId: idB, privateKeyPem: b.privateKey, tls: { key: tlsKey, cert }, peers: [{ id: idA, publicKeyPem: a.publicKey }] });
  urlB = await start(nodeB);
  t.after(() => nodeB.close());
  const nodeA = createRelayServer({ nodeId: idA, privateKeyPem: a.privateKey, tls: { key: tlsKey, cert }, peers: [{ id: idB, url: urlB, publicKeyPem: b.publicKey, caPem: cert }] });
  const urlA = await start(nodeA);
  t.after(() => nodeA.close());

  const payload = randomBytes(256); // opaque test bytes, never a real chat message
  const now = Date.now();
  const envelope = signEnvelope({
    messageId: randomBytes(16).toString("hex"),
    destinationNodeId: idB,
    issuedAt: now,
    expiresAt: now + 30_000,
    senderPublicKeyPem: sender.publicKey,
    payloadB64: b64(payload),
  }, sender.privateKey);
  const response = await post(urlA, { destinationNodeId: idB, envelope }, cert);
  assert.equal(response.status, 200);
  assert.equal(response.headers["cache-control"], "no-store, max-age=0");
  assert.equal(verifyAck(response, a.publicKey), true);
  const ack = JSON.parse(response.body.toString("utf8"));
  assert.equal(ack.ok, true);
  assert.equal(ack.destinationNodeId, idB);
  assert.equal(ack.messageId, envelope.messageId);
  assert.equal(ack.payloadHash, digest(payload));
});

test("a relay rejects a tampered sender signature", async (t) => {
  const work = mkdtempSync(join(tmpdir(), "unvor-relay-lab-"));
  t.after(() => rmSync(work, { recursive: true, force: true }));
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", join(work, "tls.key"), "-out", join(work, "tls.crt"), "-subj", "/CN=localhost", "-addext", "subjectAltName=IP:127.0.0.1,DNS:localhost", "-days", "1"], { stdio: "ignore" });
  const cert = readFileSync(join(work, "tls.crt"), "utf8");
  const tlsKey = readFileSync(join(work, "tls.key"), "utf8");
  const node = keypair();
  const sender = keypair();
  const id = nodeIdFor(node.publicKey);
  const server = createRelayServer({ nodeId: id, privateKeyPem: node.privateKey, tls: { key: tlsKey, cert } });
  const url = await start(server);
  t.after(() => server.close());
  const now = Date.now();
  const envelope = signEnvelope({
    messageId: randomBytes(16).toString("hex"),
    destinationNodeId: id,
    issuedAt: now,
    expiresAt: now + 30_000,
    senderPublicKeyPem: sender.publicKey,
    payloadB64: b64(Buffer.from("opaque")),
  }, sender.privateKey);
  envelope.payloadB64 = b64(Buffer.from("altered"));
  const response = await post(url, { destinationNodeId: id, envelope }, cert);
  assert.equal(response.status, 401);
  assert.equal(JSON.parse(response.body.toString("utf8")).error, "invalid sender signature");
});
