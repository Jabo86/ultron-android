import assert from "node:assert/strict";
import { ml_dsa87 } from "@noble/post-quantum/ml-dsa.js";
import { keygen, utf8Decode, utf8Encode } from "../src/lib/crypto.js";
import { groupAuthenticationService, signGroupCredential } from "../src/lib/groupMemberProof.js";

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
