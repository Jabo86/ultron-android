import assert from "node:assert/strict";
import { ml_kem768 } from "@noble/post-quantum/ml-kem.js";
import { bytesToHex, deriveDhKeypair, deriveKemKeypair, keygen, randomHex, hexToBytes } from "../src/lib/crypto.js";
import { initSender2, initReceiver2, ratchetEncrypt, ratchetDecrypt } from "../src/lib/ratchetCore.js";

const secret = keygen().secretKeyHex;
const kem = deriveKemKeypair(secret);
const dh = deriveDhKeypair(secret);
const prekey = ml_kem768.keygen(hexToBytes(randomHex(64)));
const initial = initSender2({
  theirStaticPk: bytesToHex(kem.publicKey), theirDhPk: bytesToHex(dh.publicKey),
  theirRatchetPk: bytesToHex(prekey.publicKey), pkId: "test-key", myDev: "a", theirDev: "b", peer: "b",
});
const first = ratchetEncrypt(initial, "prima busta");
const second = ratchetEncrypt(first.state, "seconda busta");
const third = ratchetEncrypt(second.state, "terza busta");
const receiver = (key) => initReceiver2({
  header: first.env.h, myStaticSk: bytesToHex(kem.secretKey), myStaticPk: bytesToHex(kem.publicKey),
  myDhSk: bytesToHex(dh.secretKey), myDhPk: bytesToHex(dh.publicKey),
  myRatchetPk: bytesToHex(prekey.publicKey), myRatchetSk: bytesToHex(key), myDev: "b", peer: "a",
});
const original = receiver(prekey.secretKey);
const received = ratchetDecrypt(original, first.env);
assert.equal(received?.plaintext, "prima busta");
assert.equal(ratchetDecrypt(received.state, first.env), null, "Reject replay");
const changed = (second.env.ct[0] === "A" ? "B" : "A") + second.env.ct.slice(1);
assert.equal(ratchetDecrypt(received.state, { ...second.env, ct: changed }), null, "Reject tampering");
const ahead = ratchetDecrypt(received.state, third.env);
assert.equal(ahead?.plaintext, "terza busta");
assert.equal(ratchetDecrypt(ahead.state, second.env)?.plaintext, "seconda busta", "Accept out of order");

// Simulate theft of the long-term identity, without the one-time secret or session state.
const compromised = receiver(kem.secretKey);
assert.equal(ratchetDecrypt(compromised, first.env), null);
assert.equal(ratchetDecrypt(compromised, second.env), null);
assert.equal(ratchetDecrypt(compromised, third.env), null);
console.log("ULTRON hybrid ratchet core: prekey required, tampering and replay rejected, out-of-order delivery verified.");
