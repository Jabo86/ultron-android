import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { packMessage } from "../src/lib/crypto.js";
import { archivablePayload, historyRecord } from "../src/lib/ratchetHistory.js";

const user = { lns: "b@ultron.uns", server: "https://49.12.242.0" };
const msg = { conv_id: "aa".repeat(32), message_id: "bb".repeat(12), from_lns: "a@ultron.uns" };
const envelope = { for: user.lns, r: 2, iv: "iv", ct: "ct", h: { v: 2, n: 1, init: { pk_id: "key-id" } } };
const record = historyRecord(user, msg, envelope);
assert.equal(historyRecord(user, msg, { ...envelope }).digest, record.digest);
assert.notEqual(historyRecord(user, msg, { ...envelope, h: { ...envelope.h, n: 2 } }).digest, record.digest);
assert.notEqual(historyRecord({ ...user, lns: "c@ultron.uns" }, msg, envelope).name, record.name);
assert.notEqual(historyRecord({ ...user, server: "https://other.example" }, msg, envelope).name, record.name);
assert.equal(historyRecord(user, { ...msg, message_id: "missing" }, envelope), null);
assert.equal(archivablePayload(packMessage("test")), true);
assert.equal(archivablePayload(packMessage("temporary", [], null, 60)), false);
assert.equal(archivablePayload(packMessage("\u0001rst:control")), false);

const lock = readFileSync(new URL("../src/lib/lock.js", import.meta.url), "utf8");
const storage = new Map();
let fail = false;
let delay;
const AsyncStorage = {
  async multiSet(rows) {
    if (delay) await delay;
    if (fail) throw new Error("disk full");
    for (const [name, data] of rows) storage.set(name, data);
  },
};
function load() {
  const blobCache = new Map();
  const context = runInNewContext(
    "let memNs = ''; let memKey = null; let storageEpoch = 0;" +
    lock.slice(lock.indexOf("export function setBlobDurably"), lock.indexOf("/// Con i nomi opachi"))
      .replaceAll("export ", "") +
    "\n({ setBlobsDurably, lock: () => { storageEpoch++; blobCache.clear(); } })",
    {
      AsyncStorage, blobCache, hasPin: async () => false, deviceKey: async () => ({}),
      noteName: async () => {}, blobKey: (name) => name, encryptedBlob: (value) => JSON.stringify(value),
    },
  );
  return { ...context, blobCache };
}
const state = load();
const entries = [["rat", { counter: 1 }], [record.name, { digest: record.digest, plaintext: "message" }]];
fail = true;
await assert.rejects(state.setBlobsDurably(entries), /disk full/);
assert.equal(storage.size, 0);
assert.equal(state.blobCache.size, 0);
fail = false;
await state.setBlobsDurably(entries);
assert.equal(state.blobCache.size, 2);
const restarted = load();
assert.equal(restarted.blobCache.size, 0);
assert.equal(JSON.parse(storage.get("rat")).counter, 1);
assert.equal(JSON.parse(storage.get(record.name)).plaintext, "message");

let resolve;
delay = new Promise((r) => { resolve = r; });
const pending = restarted.setBlobsDurably(entries);
await new Promise((r) => setImmediate(r));
restarted.lock();
resolve();
await assert.rejects(pending, /sessione locale/);
assert.equal(restarted.blobCache.size, 0);
console.log("ULTRON ratchet history: metadata binding, expiry exclusions, write ordering, restart and lock verified.");

const receiver = readFileSync(new URL("../src/lib/ratchet.js", import.meta.url), "utf8");
const savedState = new Map([["rat", { "sender|receiver": { peer: msg.from_lns, opened: 0 } }]]);
let attemptCount = 0;
const wire = { ...envelope, h: { ...envelope.h, sdev: "sender", init: null } };
function receiveOnDevice() {
  return runInNewContext(
    receiver.slice(receiver.indexOf("export function tryRatchetDecrypt("), receiver.indexOf("/// Numeri per il pannello")).replaceAll("export ", "") +
    "\ntryRatchetDecrypt",
    {
      withRatchetState: async (fn) => fn(), myDeviceId: async () => "receiver",
      loadAll: async () => structuredClone(savedState.get("rat")), getBlob: async (name) => savedState.get(name),
      sessionKey: (sender, device) => sender + "|" + device,
      saveAll: async (all, record, plaintext) => {
        savedState.set("rat", all);
        savedState.set(record.name, { digest: record.digest, plaintext });
      },
      historyRecord, ratchetDecrypt: (state) => {
        attemptCount++;
        if (state.opened) return null;
        return { state: { ...state, opened: 1 }, plaintext: packMessage("dopo il riavvio") };
      },
    },
  );
}
const opened = await receiveOnDevice()([wire], user, msg.from_lns, msg);
assert.equal(JSON.parse(opened).t, "dopo il riavvio");
assert.equal(await receiveOnDevice()([wire], user, msg.from_lns, msg), opened);
assert.equal(attemptCount, 1);
assert.equal(await receiveOnDevice()([{ ...wire, ct: "modified" }], user, msg.from_lns, msg), null);
assert.equal(attemptCount, 2);
console.log("Ratchet receive simulation: prior message is available after restart and a replaced envelope never reuses it.");
