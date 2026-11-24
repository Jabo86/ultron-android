import https from "node:https";
import { readFileSync } from "node:fs";
import { createHash, generateKeyPairSync, randomBytes, sign, verify } from "node:crypto";
import { signEnvelope } from "../server.mjs";

if (process.argv.length !== 6) {
  console.error("Uso: node scripts/probe-relay.mjs URL_RELAY_ORIGINE ID_NODO_DESTINAZIONE CERT_ORIGINE.pem CHIAVE_PUBBLICA_ORIGINE.pem");
  process.exit(2);
}
const [, , sourceUrl, destinationNodeId, caPath, sourcePublicKeyPath] = process.argv;
if (!/^https:\/\//.test(sourceUrl) || !/^[0-9a-f]{64}$/.test(destinationNodeId)) throw new Error("URL o ID nodo non valido");
const ca = readFileSync(caPath, "utf8");
const sourcePublicKeyPem = readFileSync(sourcePublicKeyPath, "utf8");
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const senderPublicKeyPem = publicKey.export({ type: "spki", format: "pem" });
const payload = randomBytes(256); // dati casuali di prova, non testo reale
const now = Date.now();
const envelope = signEnvelope({
  messageId: randomBytes(16).toString("hex"),
  destinationNodeId,
  issuedAt: now,
  expiresAt: now + 30_000,
  senderPublicKeyPem,
  payloadB64: payload.toString("base64"),
}, privateKey.export({ type: "pkcs8", format: "pem" }));
const body = Buffer.from(JSON.stringify({ destinationNodeId, envelope }));
const req = https.request(new URL("/v1/relay", sourceUrl), {
  method: "POST",
  headers: { "content-type": "application/json", "content-length": body.length },
  agent: new https.Agent({ ca }),
}, (res) => {
  const chunks = [];
  res.on("data", (chunk) => chunks.push(chunk));
  res.on("end", () => {
    const response = Buffer.concat(chunks);
    const time = res.headers["x-unvor-ack-time"];
    const nonce = res.headers["x-unvor-ack-nonce"];
    const sig = res.headers["x-unvor-ack-signature"];
    const hash = createHash("sha256").update(response).digest("hex");
    const signed = ["UNVOR-NODE-ACK-V1", String(res.statusCode), time, nonce, hash].join("\n");
    if (res.headers["x-unvor-node-id"] !== undefined && !verify(null, Buffer.from(signed), sourcePublicKeyPem, Buffer.from(sig || "", "base64"))) {
      console.error("Ricevuta del relay non valida");
      process.exitCode = 1;
      return;
    }
    let parsed;
    try { parsed = JSON.parse(response.toString("utf8")); } catch { parsed = {}; }
    if (res.statusCode !== 200 || parsed.destinationNodeId !== destinationNodeId || parsed.messageId !== envelope.messageId) {
      console.error("Prova relay non riuscita:", res.statusCode, parsed.error || "ricevuta non corrispondente");
      process.exitCode = 1;
      return;
    }
    console.log("OK: pacchetto casuale inoltrato e ricevuta firmata verificata.");
    console.log(`Nodo origine: ${parsed.nodeId}`);
    console.log(`Nodo destinazione: ${parsed.destinationNodeId}`);
  });
});
req.on("error", (error) => { console.error(error.message); process.exitCode = 1; });
req.end(body);
