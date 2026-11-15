import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { ml_kem768 } from "@noble/post-quantum/ml-kem.js";
import { bytesToHex, deriveDhKeypair, deriveKemKeypair, deriveKem1024Keypair, keygen, randomHex, hexToBytes, packMessage, sha256Hex } from "../src/lib/crypto.js";
import { initReceiver, initReceiver2Gens, initSender2, ratchetDecrypt, ratchetEncrypt, sessionKey } from "../src/lib/ratchetCore.js";
import { signHostedRatchetInit, verifyHostedRatchetInit } from "../src/lib/hostedRatchetProof.js";
import { archivablePayload, historyRecord, hostedSentRecord } from "../src/lib/ratchetHistory.js";

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
const envelope = signHostedRatchetInit(sender.lns, { ...sent.env, for: receiver.lns, dev: myDev, session_id: pkId }, sender.secretKeyHex);

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
const receipt = raw.slice(raw.indexOf("function hostedPendingName"), raw.indexOf("/// Numeri per il pannello"))
  .replaceAll("export ", "");
const save = raw.slice(raw.indexOf("async function saveAll"), raw.indexOf("let stateQueue"));
let fail = false, writes = 0;
const open = () => runInNewContext(save + receipt + "\nreceiveHostedRatchet", {
  archivablePayload, historyRecord, ratchetDecrypt, initReceiver2Gens, initReceiver, verifyHostedRatchetInit, sha256Hex,
  requireHostedRatchet: async () => {},
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

const alice = { ...sender, server: receiver.server, sk: sender.secretKeyHex,
  kem: deriveKemKeypair(sender.secretKeyHex), dh: deriveDhKeypair(sender.secretKeyHex),
  kem1024: deriveKem1024Keypair(sender.secretKeyHex) };
const bob = { ...receiver, sk: receiverIdentity.secretKeyHex, publicKeyHex: receiverIdentity.publicKeyHex };
const aliceDisk = new Map();
const bobDisk = new Map([[pool, structuredClone({
  generation: 1, privateKeys: { [pkId]: { pub: bytesToHex(prekey.publicKey), sec: bytesToHex(prekey.secretKey) } },
})]]);
const rows = new Map();
const migrated = new Set();
let attempts = 0, claims = 0, lost = true, generation = null;
const saveReads = (disk) => ({
  loadAll: async () => structuredClone(disk.get("rat") || {}),
  getBlob: async (name) => structuredClone(disk.get(name)),
  setBlobDurably: async (name, value) => disk.set(name, structuredClone(value)),
  removeBlob: async (name) => disk.delete(name),
  setBlobsDurably: async (entries) => {
    for (const [name, value] of entries) disk.set(name, structuredClone(value));
  },
});
function app(user, dev, partnerDev, disk) {
  return runInNewContext(save + receipt + "\n({ receiveHostedRatchet, sendHostedRatchet })", {
    ...saveReads(disk), archivablePayload, historyRecord, hostedSentRecord, sha256Hex, randomHex, bytesToHex,
    initReceiver2Gens, initReceiver, initSender2, sessionKey, ratchetEncrypt, ratchetDecrypt,
    signHostedRatchetInit, verifyHostedRatchetInit, BLOB: "rat", MAX_SESSIONS: 200,
    hostedPrekeyDevice: () => dev, parsePools: ({ devices }) => devices,
    requireHostedRatchet: async (u, peer) => { migrated.add(u.lns + peer); },
    withRatchetState: async (fn) => fn(), withHostedPrekeyStorage: async (fn) => fn(),
    claimVerifiedHostedPrekey: async () => { claims++; return { id: claims === 1 ? pkId : randomHex(16), kem: bytesToHex(prekey.publicKey) }; },
    api: {
      authenticatedScope: () => () => {},
      pilotPurgeStatus: async () => generation === null ? null : { generation },
      hostedPrekeyPools: async () => ({ devices: [{ device: partnerDev }] }),
      sendHostedRatchet: async (wire) => {
        attempts++;
        const previous = rows.get(wire.send_id);
        if (previous) assert.deepEqual(structuredClone(wire), previous.wire);
        else rows.set(wire.send_id, {
          wire: structuredClone(wire), from_lns: user.lns, envelope: wire.envelope,
          message_id: (42 + rows.size).toString(16).repeat(12), conv_id: "33".repeat(32),
        });
        if (lost) { lost = false; throw new Error("response lost after commit"); }
        const { message_id, conv_id } = rows.get(wire.send_id);
        return { ok: true, message_id, conv_id };
      },
    },
  });
}

const contact = (user) => ({ identityKey: user.publicKeyHex, kem: bytesToHex(user.kem.publicKey), dh: bytesToHex(user.dh.publicKey) });
const sendFromAlice = (text) => app(alice, theirDev, myDev, aliceDisk).sendHostedRatchet(text, alice, bob.lns, "", contact(bob));
await assert.rejects(sendFromAlice(payload), /response lost/);
assert.equal(rows.size, 1);
const firstAck = await sendFromAlice(payload);
assert.equal(rows.size, 1);
assert.equal(attempts, 2);
assert.equal(claims, 1);
const [sendId, firstRow] = [...rows.entries()][0];
assert.equal(firstAck.message_id, firstRow.message_id);
assert.equal(aliceDisk.get(hostedSentRecord(alice, bob.lns, sendId)), payload);
assert.equal(await app(bob, myDev, theirDev, bobDisk).receiveHostedRatchet(firstRow, bob, "", alice.publicKeyHex), payload);
assert.equal(migrated.size, 2);

const answer = packMessage("risposta nel ratchet");
await app(bob, myDev, theirDev, bobDisk).sendHostedRatchet(answer, bob, alice.lns, "", contact(alice));
const secondRow = [...rows.values()][1];
assert.equal(secondRow.envelope.session_id, firstRow.envelope.session_id);
assert.equal(await app(alice, theirDev, myDev, aliceDisk).receiveHostedRatchet(secondRow, alice, "", bob.publicKeyHex), answer);
assert.equal(claims, 1);
console.log("ULTRON pilot: loss of HTTP response, idempotent retry after restart, own encrypted history and reply on the same ratchet verified in simulation.");

generation = 0;
lost = true;
await assert.rejects(sendFromAlice(packMessage("invio prima della cancellazione")), /response lost/);
const old = [...rows.values()].at(-1);
const oldAttempts = attempts;
generation = 1;
await assert.rejects(sendFromAlice(packMessage("invio prima della cancellazione")), /è stata eliminata/);
assert.equal(attempts, oldAttempts);
await sendFromAlice(packMessage("nuova cronologia"));
const fresh = [...rows.values()].at(-1);
assert.equal(fresh.wire.generation, 1);
assert.notEqual(fresh.envelope.session_id, old.envelope.session_id);
assert.ok(fresh.envelope.h.init);
console.log("ULTRON pilot: retired outbox cannot replay and a new generation starts a new session.");
