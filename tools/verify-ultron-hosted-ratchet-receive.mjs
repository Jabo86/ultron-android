import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { ml_kem768 } from "@noble/post-quantum/ml-kem.js";
import { bytesToHex, deriveDhKeypair, deriveKemKeypair, deriveKem1024Keypair, keygen, randomHex, hexToBytes, packMessage } from "../src/lib/crypto.js";
import { initReceiver, initReceiver2Gens, initSender2, ratchetDecrypt, ratchetEncrypt, sessionKey } from "../src/lib/ratchetCore.js";
import { signHostedRatchetInit, verifyHostedRatchetInit } from "../src/lib/hostedRatchetProof.js";
import { archivablePayload, historyRecord } from "../src/lib/ratchetHistory.js";

const sender = { lns: "alice@ultron.uns", ...keygen() };
const receiverIdentity = keygen();
const receiver = {
  lns: "bob@ultron.uns", server: "https://test.invalid",
  kem: deriveKemKeypair(receiverIdentity.secretKeyHex),
  kem1024: deriveKem1024Keypair(receiverIdentity.secretKeyHex),
  dh: deriveDhKeypair(receiverIdentity.secretKeyHex),
};
const myDev = "ab".repeat(16), theirDev = "cd".repeat(16), pkId = "ef".repeat(16);
const prekey = ml_kem768.keygen(hexToBytes(randomHex(64)));
const start = initSender2({
  theirStaticPk: bytesToHex(receiver.kem.publicKey), theirDhPk: bytesToHex(receiver.dh.publicKey),
  theirRatchetPk: bytesToHex(prekey.publicKey), pkId, myDev: theirDev, theirDev: myDev,
  peer: receiver.lns,
});
const payload = packMessage("consegna di prova");
const sent = ratchetEncrypt(start, payload);
const envelope = signHostedRatchetInit(sender.lns, { ...sent.env, for: receiver.lns, dev: myDev }, sender.secretKeyHex);

assert.ok(verifyHostedRatchetInit(sender.lns, receiver.lns, myDev, envelope, sender.publicKeyHex));
for (const altered of [
  { ...envelope, ct: "A" + envelope.ct },
  { ...envelope, dev: theirDev },
  { ...envelope, h: { ...envelope.h, sdev: myDev } },
  { ...envelope, h: { ...envelope.h, init: { ...envelope.h.init, pk_id: theirDev } } },
]) assert.equal(verifyHostedRatchetInit(sender.lns, receiver.lns, myDev, altered, sender.publicKeyHex), false);
assert.equal(verifyHostedRatchetInit("fake@ultron.uns", receiver.lns, myDev, envelope, sender.publicKeyHex), false);
assert.equal(verifyHostedRatchetInit(sender.lns, receiver.lns, myDev, envelope, keygen().publicKeyHex), false);

const local = new Map();
const pool = "hosted-prekeys:" + myDev;
local.set(pool, { generation: 1, privateKeys: { [pkId]: { pub: bytesToHex(prekey.publicKey), sec: bytesToHex(prekey.secretKey) } } });
const raw = readFileSync(new URL("../src/lib/ratchet.js", import.meta.url), "utf8");
const receipt = raw.slice(raw.indexOf("export function receiveHostedRatchet"), raw.indexOf("/// Numeri per il pannello"))
  .replaceAll("export ", "");
const save = raw.slice(raw.indexOf("async function saveAll"), raw.indexOf("let stateQueue"));
let fail = false, writes = 0;
const open = () => runInNewContext(save + receipt + "\nreceiveHostedRatchet", {
  archivablePayload, historyRecord, ratchetDecrypt, initReceiver2Gens, initReceiver, verifyHostedRatchetInit,
  api: { authenticatedScope: () => () => {} }, hostedPrekeyDevice: () => myDev, bytesToHex, sessionKey,
  withRatchetState: async (fn) => fn(), withHostedPrekeyStorage: async (fn) => fn(),
  BLOB: "rat", MAX_SESSIONS: 200, loadAll: async () => structuredClone(local.get("rat") || {}),
  getBlob: async (name) => local.get(name),
  setBlobsDurably: async (entries) => {
    if (fail) throw new Error("disk full");
    writes++;
    for (const [key, value] of entries) local.set(key, value);
  },
});
const message = { conv_id: "11".repeat(32), message_id: "22".repeat(12), from_lns: sender.lns, envelope };
assert.equal(await open()({ ...message, envelope: { ...envelope, init_sig: "0".repeat(6618) } }, receiver, "", sender.publicKeyHex), null);
assert.equal(writes, 0);
fail = true;
await assert.rejects(open()(message, receiver, "", sender.publicKeyHex), /disk full/);
assert.ok(local.get(pool).privateKeys[pkId]);
assert.equal(local.has("rat"), false);
fail = false;
assert.equal(await open()(message, receiver, "", sender.publicKeyHex), payload);
assert.equal(local.get(pool).privateKeys[pkId], undefined);
assert.equal(writes, 1);
assert.equal(await open()(message, receiver, "", sender.publicKeyHex), payload);
assert.equal(writes, 1, "Reopening an archived row must never advance the ratchet again");
console.log("ULTRON hosted receive: authenticated init, atomic prekey consumption and encrypted-history entry verified in simulation.");
