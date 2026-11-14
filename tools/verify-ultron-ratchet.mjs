import assert from "node:assert/strict";
import { ml_kem768 } from "@noble/post-quantum/ml-kem.js";
import { bytesToHex, deriveDhKeypair, deriveKemKeypair, keygen, randomHex, hexToBytes } from "../src/lib/crypto.js";
import { signPrekey, verifyClaimedPrekey } from "../src/lib/prekeyProof.js";
import { initSender2, initReceiver2, ratchetEncrypt, ratchetDecrypt } from "../src/lib/ratchetCore.js";

const identity = keygen();
const secret = identity.secretKeyHex;
const kem = deriveKemKeypair(secret);
const dh = deriveDhKeypair(secret);
const prekey = ml_kem768.keygen(hexToBytes(randomHex(64)));
const owner = "b@ultron.uns";
const deviceA = "11".repeat(16);
const deviceB = "22".repeat(16);
const prekeyId = "33".repeat(16);
const signed = signPrekey(owner, deviceB, 1, prekeyId, bytesToHex(prekey.publicKey), secret);
const claim = { device: deviceB, generation: 1, prekey: signed };
assert.equal(verifyClaimedPrekey(owner, deviceB, claim, identity.publicKeyHex), true);
assert.equal(verifyClaimedPrekey(owner, deviceB, { ...claim, generation: 2 }, identity.publicKeyHex), false);
assert.equal(verifyClaimedPrekey(owner, deviceA, claim, identity.publicKeyHex), false);
assert.equal(verifyClaimedPrekey(owner, deviceB, { ...claim, prekey: { ...signed, id: deviceA } }, identity.publicKeyHex), false);
assert.equal(verifyClaimedPrekey(owner, deviceB, claim, keygen().publicKeyHex), false);

const initial = initSender2({
  theirStaticPk: bytesToHex(kem.publicKey), theirDhPk: bytesToHex(dh.publicKey),
  theirRatchetPk: signed.kem, pkId: prekeyId, myDev: deviceA, theirDev: deviceB, peer: owner,
});
const first = ratchetEncrypt(initial, "prima busta");
const second = ratchetEncrypt(first.state, "seconda busta");
const third = ratchetEncrypt(second.state, "terza busta");
const receiver = (key) => initReceiver2({
  header: first.env.h, myStaticSk: bytesToHex(kem.secretKey), myStaticPk: bytesToHex(kem.publicKey),
  myDhSk: bytesToHex(dh.secretKey), myDhPk: bytesToHex(dh.publicKey),
  myRatchetPk: bytesToHex(prekey.publicKey), myRatchetSk: bytesToHex(key), myDev: deviceB, peer: "a@ultron.uns",
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

// Use persisted (serialized) state on each direction change.
const reply = ratchetEncrypt(JSON.parse(JSON.stringify(ahead.state)), "risposta");
const gotReply = ratchetDecrypt(JSON.parse(JSON.stringify(third.state)), reply.env);
assert.equal(gotReply?.plaintext, "risposta");
assert.equal(gotReply.state.pendingInit, undefined);
const fourth = ratchetEncrypt(gotReply.state, "nuovo turno");
assert.equal(ratchetDecrypt(reply.state, fourth.env)?.plaintext, "nuovo turno");

// Simulate theft of the long-term identity, without the one-time secret or session state.
const compromised = receiver(kem.secretKey);
assert.equal(ratchetDecrypt(compromised, first.env), null);
assert.equal(ratchetDecrypt(compromised, second.env), null);
assert.equal(ratchetDecrypt(compromised, third.env), null);
console.log("ULTRON ratchet: signed prekeys, two-way exchange after state reload, replay rejection and out-of-order delivery verified.");
