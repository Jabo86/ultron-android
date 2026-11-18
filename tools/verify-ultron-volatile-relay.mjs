import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { randomBytes } from "node:crypto";
import { ml_dsa65 } from "@noble/post-quantum/ml-dsa.js";
import { gcm } from "@noble/ciphers/aes.js";
import { hexToBytes, bytesToHex, signMessage } from "../src/lib/crypto.js";
import { createVolatileRelayTransport } from "../src/lib/volatileRelayTransport.js";
import { createVolatileRelayOutbox } from "../src/lib/volatileRelayOutbox.js";
import { createVolatileRelayConversation } from "../src/lib/volatileRelayConversation.js";

const lab = process.env.ULTRON_RELAY_LAB;
if (!lab) throw new Error("Set ULTRON_RELAY_LAB to the extracted ULTRON relay lab directory");
const fixtures = Array.from({ length: 2 }, () => ({
  seed: randomBytes(32).toString("hex"), token: randomBytes(32).toString("hex"),
}));
const keys = fixtures.map(item => ml_dsa65.keygen(hexToBytes(item.seed)));

async function startRelay() {
  const python = spawn("python3", ["volatile-relay-fixture.py"], {
    cwd: new URL(".", import.meta.url), env: { ...process.env, PYTHONPATH: lab }, stdio: ["pipe", "pipe", "inherit"],
  });
  const exit = once(python, "exit");
  const rl = createInterface({ input: python.stdout });
  python.stdin.write(JSON.stringify(fixtures) + "\n");
  const [line] = await Promise.race([
    once(rl, "line"),
    exit.then(() => { throw new Error("The isolated Python relay failed to start"); }),
  ]);
  const { origin, identities } = JSON.parse(line);
  const accounts = identities.map((identity, index) => {
    assert.equal(bytesToHex(keys[index].publicKey), identity.publicKey);
    return {
      ...identity, secretKey: bytesToHex(keys[index].secretKey),
      transport: createVolatileRelayTransport({
        origin, token: fixtures[index].token, loopback: true,
        sign: (data, context) => ml_dsa65.sign(data, keys[index].secretKey, { context }),
      }),
    };
  });
  return { accounts, async stop() { rl.close(); python.stdin.end(); await exit; } };
}

function memoryVault() {
  const records = new Map();
  return {
    async read(key) { return structuredClone(records.get(key)); },
    async write(entries) { for (const [key, value] of entries) records.set(key, structuredClone(value)); },
  };
}

const channelKey = randomBytes(32);
// Test-only cipher adapter. Android must supply its verified end-to-end channel.
const channel = {
  async seal(packet) {
    const nonce = randomBytes(12);
    return Buffer.concat([nonce, gcm(channelKey, nonce).encrypt(Buffer.from(JSON.stringify(packet)))]).toString("base64");
  },
  async open(text) {
    const bytes = Buffer.from(text, "base64");
    return JSON.parse(Buffer.from(gcm(channelKey, bytes.subarray(0, 12)).decrypt(bytes.subarray(12))).toString());
  },
};

const vaults = [memoryVault(), memoryVault()];
const localInbox = new Map();
const states = [[], []];
let rendered = 0;
let retryClock = Date.now();
function clients(accounts) {
  return accounts.map((account, index) => {
    const outbox = createVolatileRelayOutbox({
      prefix: "test", sender: account.mailbox, vault: vaults[index], transport: account.transport, scope() {},
      onState(id, status) { states[index].push([id, status]); }, clock: () => retryClock,
    });
    const chat = createVolatileRelayConversation({
      sender: account.mailbox, peer: accounts[1 - index], transport: account.transport, outbox, channel,
      async receiveOnce(item) {
        const slot = item.sender + ":" + item.id;
        if (!localInbox.has(slot)) {
          localInbox.set(slot, item.payload);
          rendered++;
        }
      },
      randomId: () => randomBytes(16).toString("hex"), scope() {},
      signReceipt: message => signMessage(message, account.secretKey),
    });
    return { chat, outbox, close() { chat.close(); outbox.close(); } };
  });
}

async function until(predicate) {
  for (let i = 0; i < 500 && !predicate(); i++) await delay(10);
  assert.ok(predicate(), "worker did not reach expected state");
}
const msg = "1".repeat(32);
let server = await startRelay();
let devices = clients(server.accounts);
const originalIds = server.accounts.map(account => account.mailbox);
try {
  await devices[0].chat.send(msg, "prova offline");
  assert.deepEqual(states[0], [[msg, "pending"]]);
  assert.equal(rendered, 0);
  devices[0].outbox.resume();
  await until(() => states[0].some(([, value]) => value === "awaiting-receipt"));
  await devices[1].chat.poll();
  assert.equal(rendered, 1);
  assert.equal(localInbox.get(originalIds[0] + ":" + msg), "prova offline");
  assert.ok(await vaults[0].read("test:entry:" + msg), "relay receipt has yet to be consumed by sender");

  // Stop before Alice gets the receipt. The only copy of the receipt in the
  // relay disappears. Alice's retained outbox must recreate the delivery.
  devices.forEach(device => device.close());
  await server.stop();
  server = await startRelay();
  assert.deepEqual(server.accounts.map(account => account.mailbox), originalIds);
  devices = clients(server.accounts);
  retryClock += 65000;
  devices[0].outbox.resume();
  await until(() => states[0].filter(([, value]) => value === "awaiting-receipt").length === 2);
  await devices[1].chat.poll();
  assert.equal(rendered, 1, "recipient must deduplicate after reactor restart");
  await devices[0].chat.poll();
  assert.equal(states[0].at(-1)[1], "delivered");
  assert.equal(await vaults[0].read("test:entry:" + msg), null);
  assert.deepEqual(await server.accounts[1].transport.inbox(), { messages: [] });
  console.log("PASS: relay restart, same mailbox after re-enrollment, sender retry, automatic signed receipt, no duplicate.");
} finally {
  devices.forEach(device => device.close());
  await server.stop();
}
