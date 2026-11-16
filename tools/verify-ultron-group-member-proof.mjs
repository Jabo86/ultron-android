import assert from "node:assert/strict";
import { ml_dsa87 } from "@noble/post-quantum/ml-dsa.js";
import { keygen, utf8Decode, utf8Encode } from "../src/lib/crypto.js";
import { groupAuthenticationService, groupIdentityFingerprint, signGroupCredential } from "../src/lib/groupMemberProof.js";

const server = "https://pilot.invalid/ratchet-pilot";
const keys = keygen();
const alice = { server, lns: "alice@ultron.uns", sk: keys.secretKeyHex };
const device = "0a".repeat(16);
const mls = ml_dsa87.keygen();
const credential = { credentialType: "basic", identity: signGroupCredential(alice, device, mls.publicKey) };
const verifier = groupAuthenticationService(server, async (account, installation) =>
  account === alice.lns && installation === device ? keys.publicKeyHex : null
);

assert.equal(await verifier.validateCredential(credential, mls.publicKey), true);
assert.equal(await verifier.validateCredential(credential, ml_dsa87.keygen().publicKey), false);
assert.equal(await verifier.validateCredential({ ...credential, credentialType: "x509" }, mls.publicKey), false);
assert.equal(await groupAuthenticationService(server + "/elsewhere", async () => keys.publicKeyHex)
  .validateCredential(credential, mls.publicKey), false);
assert.equal(await groupAuthenticationService(server, async () => null).validateCredential(credential, mls.publicKey), false);
assert.equal(await groupAuthenticationService(server, async () => keygen().publicKeyHex)
  .validateCredential(credential, mls.publicKey), false);

const fields = JSON.parse(utf8Decode(credential.identity));
for (const [index, value] of [[2, "wrong-suite"], [3, "other@ultron.uns"], [4, "11".repeat(16)]]) {
  const tampered = [...fields];
  tampered[index] = value;
  assert.equal(await verifier.validateCredential({
    ...credential, identity: utf8Encode(JSON.stringify(tampered)),
  }, mls.publicKey), false);
}
console.log("MLS credentials bind the verified ULTRON identity, installation, gateway, ciphersuite and MLS signing key.");

const { readFileSync } = await import("node:fs");
const { runInNewContext } = await import("node:vm");
const peerKeys = keygen();
const peer = { ...alice, lns: "bob@ultron.uns", sk: peerKeys.secretKeyHex };
const peerDevice = "1b".repeat(16);
const localUser = { ...alice, pk: keys.publicKeyHex };
const peerCredential = { credentialType: "basic", identity: signGroupCredential(peer, peerDevice, mls.publicKey) };
let ended = false, verified = true, pinnedIdentity = peerKeys.publicKeyHex, legacy = false, activeDevices = [{ device: peerDevice }], lookups = 0;
const source = readFileSync(new URL("../src/lib/hostedGroupCredentials.js", import.meta.url), "utf8");
const makeAdapter = runInNewContext(source.replace(/^import .+;$/gm, "").replace(/^export /gm, "") + "\nhostedGroupCredentials", {
  api: {
    authenticatedScope: () => () => { if (ended) throw new Error("session ended"); },
    hostedPrekeyPools: async account => ({ devices: account === alice.lns ? [{ device }] : activeDevices }),
  },
  hostedRatchetPilot: () => true,
  verifiedContact: async () => { lookups++; if (!verified) throw new Error("unverified"); return { identityKey: peerKeys.publicKeyHex }; },
  deviceId: async () => "local",
  hostedPrekeyDevice: () => device,
  parsePools: response => response.devices,
  getVerified: async () => !verified ? null : legacy ? { fp: "aa".repeat(32) } :
    { identityFp: groupIdentityFingerprint(peer.lns, pinnedIdentity) },
  groupAuthenticationService,
  groupIdentityFingerprint,
  signGroupCredential,
});
const operation = await makeAdapter(localUser);
assert.equal(await operation.authService.validateCredential(operation.createCredential(mls.publicKey), mls.publicKey), true);
assert.equal(await operation.authService.validateCredential(peerCredential, mls.publicKey), true);
assert.equal(await operation.authService.validateCredential(peerCredential, mls.publicKey), true);
assert.equal(lookups, 1);
ended = true;
assert.equal(await operation.authService.validateCredential(peerCredential, mls.publicKey), false);
ended = false;
activeDevices = [{ device: "2b".repeat(16) }];
assert.equal(await (await makeAdapter(localUser)).authService.validateCredential(peerCredential, mls.publicKey), false);
activeDevices = [{ device: peerDevice }];
pinnedIdentity = null;
assert.equal(await (await makeAdapter(localUser)).authService.validateCredential(peerCredential, mls.publicKey), false);
pinnedIdentity = keygen().publicKeyHex;
assert.equal(await (await makeAdapter(localUser)).authService.validateCredential(peerCredential, mls.publicKey), false);
pinnedIdentity = peerKeys.publicKeyHex;
legacy = true;
assert.equal(await (await makeAdapter(localUser)).authService.validateCredential(peerCredential, mls.publicKey), true);
legacy = false;
verified = false;
assert.equal(await (await makeAdapter(localUser)).authService.validateCredential(peerCredential, mls.publicKey), false);
console.log("Pilot group authentication rejects unsigned contacts, inactive devices and callbacks after logout.");

const qrSource = readFileSync(new URL("../src/lib/verify.js", import.meta.url), "utf8");
const qr = runInNewContext(qrSource.slice(qrSource.indexOf("const GROUP_QR_PREFIX"), qrSource.indexOf("export function myFingerprint"))
  .replace(/^export /gm, "") + "\n({qrPayload,parseQr})", { QR_PREFIX: "LATTICE1" });
const fp = "aa".repeat(32);
const identityFp = groupIdentityFingerprint(peer.lns, peerKeys.publicKeyHex);
const freshQr = qr.qrPayload(peer.lns, fp, identityFp);
assert.match(freshQr, /^ULTRON2:/);
assert.equal(qr.parseQr(freshQr).identityFp, identityFp);
assert.equal(qr.parseQr(qr.qrPayload(peer.lns, fp)).identityFp, undefined);
assert.equal(qr.parseQr(freshQr + ":ignored"), null);
console.log("ULTRON2 QR carries both fingerprints; existing direct-chat fingerprints follow the direct-chat signed identity check.");
