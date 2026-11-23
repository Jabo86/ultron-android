import { readFileSync } from "node:fs";
import { createPrivateKey, createPublicKey } from "node:crypto";
import { createRelayServer, nodeIdFor } from "./server.mjs";

const configPath = process.env.UNVOR_RELAY_CONFIG || "/etc/unvor-relay/node.json";
const config = JSON.parse(readFileSync(configPath, "utf8"));
const privateKeyPem = readFileSync(config.identityPrivateKeyFile, "utf8");
const publicKeyPem = createPublicKey(createPrivateKey(privateKeyPem)).export({ type: "spki", format: "pem" });
const nodeId = nodeIdFor(publicKeyPem);
const peers = (config.peers || []).map((peer) => ({
  ...peer,
  publicKeyPem: readFileSync(peer.publicKeyFile, "utf8"),
  caPem: peer.caFile ? readFileSync(peer.caFile, "utf8") : undefined,
}));
const server = createRelayServer({
  nodeId,
  privateKeyPem,
  peers,
  tls: {
    key: readFileSync(config.tlsPrivateKeyFile, "utf8"),
    cert: readFileSync(config.tlsCertificateFile, "utf8"),
  },
});
const host = process.env.UNVOR_RELAY_HOST || "0.0.0.0";
const port = Number(process.env.UNVOR_RELAY_PORT || config.port || 8443);
server.listen(port, host, () => {
  // Only public node health information is printed. Request and packet logs are disabled.
  process.stdout.write(`UNVOR relay lab ${nodeId} listening on ${host}:${port}\n`);
});
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
