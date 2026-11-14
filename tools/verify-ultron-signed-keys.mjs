import assert from "node:assert/strict";
import { keygen } from "../src/lib/crypto.js";
import { signChatKeys, verifyChatKeys } from "../src/lib/signedKeyProof.js";

const owner = "test@ultron.uns";
const identity = keygen();
const bundle = {
  identity_pk_hex: identity.publicKeyHex,
  kem_pk_hex: "11".repeat(1184),
  dh_pk_hex: "22".repeat(32),
};
bundle.signature_hex = signChatKeys(owner, bundle.kem_pk_hex, bundle.dh_pk_hex, identity.secretKeyHex);
assert.equal(verifyChatKeys(owner, bundle), true);
assert.equal(verifyChatKeys("other@ultron.uns", bundle), false);
assert.equal(verifyChatKeys(owner, { ...bundle, dh_pk_hex: "33".repeat(32) }), false);
assert.equal(verifyChatKeys(owner, { ...bundle, kem_pk_hex: "44".repeat(1184) }), false);
assert.equal(verifyChatKeys(owner, { ...bundle, signature_hex: "00" }), false);
assert.equal(verifyChatKeys(owner, { ...bundle, identity_pk_hex: keygen().publicKeyHex }), false);
console.log("ULTRON signed contact key checks passed.");
