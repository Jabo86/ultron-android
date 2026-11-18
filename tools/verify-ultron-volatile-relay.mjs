import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { once } from "node:events";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { ml_dsa65 } from "@noble/post-quantum/ml-dsa.js";
import { hexToBytes, bytesToHex, signMessage } from "../src/lib/crypto.js";
import { createVolatileRelayTransport, relayPacketDigest, relayReceiptPayload } from "../src/lib/volatileRelayTransport.js";
import { createVolatileRelayOutbox } from "../src/lib/volatileRelayOutbox.js";

const lab = process.env.ULTRON_RELAY_LAB;
if (!lab) throw new Error("Set ULTRON_RELAY_LAB to the extracted ULTRON relay lab directory");
const python = spawn("python3", ["volatile-relay-fixture.py"], {
  cwd: new URL(".", import.meta.url), env: { ...process.env, PYTHONPATH: lab }, stdio: ["pipe", "pipe", "inherit"],
});
const exit = once(python, "exit");
const rl = createInterface({ input: python.stdout });
const [line] = await Promise.race([
  once(rl, "line"),
  exit.then(() => { throw new Error("The isolated Python relay failed to start"); }),
]);
const { origin, identities } = JSON.parse(line);
const signingTimes = [];
const [alice, bob] = identities.map(identity => {
  const keys = ml_dsa65.keygen(hexToBytes(identity.seed));
  assert.equal(bytesToHex(keys.publicKey), identity.publicKey);
  const sign = (data, context) => {
    const start = performance.now();
    const sig = ml_dsa65.sign(data, keys.secretKey, { context });
    signingTimes.push(performance.now() - start);
    return sig;
  };
  return { ...identity, keys, transport: createVolatileRelayTransport({ origin, ...identity, sign, loopback: true }) };
});
const data = new Map();
const vault = {
  async read(key) { return structuredClone(data.get(key)); },
  async write(entries) { for (const [key, value] of entries) data.set(key, structuredClone(value)); },
};
const events = [];
const entry = {
  id: "1".repeat(32), ciphertext: Buffer.from("opaque test packet").toString("base64"),
  recipient: bob.mailbox, recipientKey: bob.publicKey,
};
let sentAttempts = 0;
const create = transport => createVolatileRelayOutbox({
  prefix: "test", sender: alice.mailbox, vault, transport, scope() {},
  onState(id, status) { assert.equal(id, entry.id); events.push(status); },
});
async function until(predicate) {
  for (let i = 0; i < 500 && !predicate(); i++) await delay(10);
  assert.ok(predicate(), "worker did not reach expected state");
}

const before = create({ async send() { sentAttempts++; throw new Error("offline"); } });
const after = create(alice.transport);
try {
  const start = performance.now();
  await before.enqueue(entry);
  const queueMs = performance.now() - start;
  assert.equal(sentAttempts, 0);
  before.resume();
  await until(() => sentAttempts === 1 && events.length === 2);
  before.close();
  after.resume();
  await until(() => events.includes("awaiting-receipt"));
  const inbox = await bob.transport.inbox();
  assert.equal(inbox.messages[0].message_id, entry.id);
  assert.ok(data.get("test:entry:" + entry.id), "relay acknowledgment must retain the local entry");
  const receipt = relayReceiptPayload(alice.mailbox, bob.mailbox, entry.id, relayPacketDigest(entry.ciphertext));
  assert.equal(await after.acceptReceipt(entry.id, signMessage(receipt, bytesToHex(alice.keys.secretKey))), false);
  await bob.transport.acknowledge({ sender: alice.mailbox, id: entry.id });
  assert.ok(await after.acceptReceipt(entry.id, signMessage(receipt, bytesToHex(bob.keys.secretKey))));
  assert.equal(data.get("test:entry:" + entry.id), null);
  assert.equal(events.at(-1), "delivered");
  console.log("PASS: offline retry, reopened queue, cross-language request proof, recipient-only receipt.");
  console.log(`Local Node simulation: enqueue ${queueMs.toFixed(2)} ms, request signatures ${signingTimes.map(x=>x.toFixed(2)).join(", ")} ms. No Android storage or WAN measured.`);
} finally {
  before.close(); after.close();
  rl.close();
  python.stdin.end();
  await exit;
}
