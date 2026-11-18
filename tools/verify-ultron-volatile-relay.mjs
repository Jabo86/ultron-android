import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { createHash, randomBytes, webcrypto } from "node:crypto";
import { ml_dsa65 } from "@noble/post-quantum/ml-dsa.js";
import { defaultClientConfig } from "ts-mls/clientConfig.js";
import * as mls from "ts-mls";
import { createMlsSubtleCrypto } from "../src/lib/mlsMobileCrypto.js";
import { groupAuthenticationService, signGroupCredential } from "../src/lib/groupMemberProof.js";
import { createMlsGroupEngine } from "../src/lib/mlsGroupEngine.js";
import { createVolatileRelayMlsChannel } from "../src/lib/volatileRelayMlsChannel.js";
import { hexToBytes, bytesToHex, signMessage } from "../src/lib/crypto.js";
import { createVolatileRelayTransport, volatileMailbox } from "../src/lib/volatileRelayTransport.js";
import { createVolatileRelayOutbox } from "../src/lib/volatileRelayOutbox.js";
import { createVolatileRelayConversation } from "../src/lib/volatileRelayConversation.js";

const lab = process.env.ULTRON_RELAY_LAB;
if (!lab) throw new Error("Set ULTRON_RELAY_LAB to the extracted ULTRON relay lab directory");
const fixtures = Array.from({ length: 2 }, () => ({
  seed: randomBytes(32).toString("hex"), token: randomBytes(32).toString("hex"),
}));
const keys = fixtures.map(item => ml_dsa65.keygen(hexToBytes(item.seed)));
Object.defineProperty(globalThis, "crypto", {
  value: { getRandomValues: webcrypto.getRandomValues.bind(webcrypto), subtle: createMlsSubtleCrypto() },
});
const authority = ml_dsa65.keygen(randomBytes(32));
const serverScope = "https://pilot.invalid/private-relay";
const members = keys.map((key, index) => ({
  account: ["alice@ultron.uns", "bob@ultron.uns"][index],
  publicKey: bytesToHex(key.publicKey), secretKey: bytesToHex(key.secretKey),
}));
for (const member of members) member.mailbox = volatileMailbox(member.publicKey);
const engines = await Promise.all(members.map(member => createMlsGroupEngine(mls, defaultClientConfig, {
  authService: groupAuthenticationService(serverScope, async (account, device) =>
    members.find(row => row.account === account && row.mailbox === device)?.publicKey),
  createCredential: publicKey => ({ credentialType: "basic", identity: signGroupCredential(
    { server: serverScope, lns: member.account, sk: member.secretKey }, member.mailbox, publicKey,
  ) }),
})));
const groupId = randomBytes(32).toString("hex");
const founder = members[0].account;
const peerPackage = await engines[1].createKeyPackage();
const created = await engines[0].change(await engines[0].create(groupId), groupId, 0,
  "add", members[1].account, peerPackage.wire);
const snapshots = [created.snapshot, await engines[1].join(groupId, 1, created.welcome, peerPackage, founder)];
const authorityContext = Buffer.from("ULTRON relay admission v1");
const sha256 = bytes => createHash("sha256").update(bytes).digest();

function issueGrant(boot, index) {
  const expires = Math.floor(Date.now() / 1000) + 90;
  const time = Buffer.alloc(8);
  time.writeBigUInt64BE(BigInt(expires));
  const publicKey = bytesToHex(keys[index].publicKey);
  const transcript = Buffer.concat([
    Buffer.from(boot, "hex"), time, sha256(keys[index].publicKey),
    sha256(Buffer.from(fixtures[index].token, "hex")),
  ]);
  const authoritySignature = bytesToHex(ml_dsa65.sign(transcript, authority.secretKey, { context: authorityContext }));
  return { boot, expires, publicKey, authoritySignature };
}

async function startRelay() {
  const python = spawn("python3", ["volatile-relay-fixture.py"], {
    cwd: new URL(".", import.meta.url), env: { ...process.env, PYTHONPATH: lab }, stdio: ["pipe", "pipe", "inherit"],
  });
  const exit = once(python, "exit");
  const rl = createInterface({ input: python.stdout });
  python.stdin.write(bytesToHex(authority.publicKey) + "\n");
  const [line] = await Promise.race([
    once(rl, "line"),
    exit.then(() => { throw new Error("The isolated Python relay failed to start"); }),
  ]);
  const { origin } = JSON.parse(line);
  const accounts = keys.map((key, index) => {
    const publicKey = bytesToHex(key.publicKey);
    return {
      publicKey, mailbox: volatileMailbox(publicKey), secretKey: bytesToHex(key.secretKey),
      transport: createVolatileRelayTransport({
        origin, token: fixtures[index].token, loopback: true,
        sign: (data, context) => ml_dsa65.sign(data, key.secretKey, { context }),
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
    const channel = createVolatileRelayMlsChannel({
      engine: engines[index], vault: vaults[index], storageKey: "mls",
      pairing: { id: groupId, epoch: 1, founder, snapshot: snapshots[index] },
      mine: members[index], peer: members[1 - index],
      sign: message => signMessage(message, account.secretKey), scope() {},
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
  const firstBoot = await server.accounts[0].transport.admissionInfo();
  const previousGrant = issueGrant(firstBoot, 0);
  await server.accounts[0].transport.admit(previousGrant);
  await server.accounts[1].transport.admit(issueGrant(firstBoot, 1));
  await devices[0].chat.send(msg, "prova offline");
  assert.deepEqual(states[0], [[msg, "pending"]]);
  assert.equal(rendered, 0);
  devices[0].outbox.resume();
  await until(() => states[0].some(([, value]) => value === "awaiting-receipt"));
  const spy = await server.accounts[1].transport.inbox();
  assert.equal(spy.messages.length, 1);
  assert.equal(Buffer.from(spy.messages[0].ciphertext, "base64").includes(Buffer.from("prova offline")), false);
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
  const secondBoot = await server.accounts[0].transport.admissionInfo();
  assert.notEqual(secondBoot, firstBoot);
  await assert.rejects(server.accounts[0].transport.admit(previousGrant), { status: 403 });
  await assert.rejects(server.accounts[0].transport.inbox(), { status: 401 });
  await server.accounts[0].transport.admit(issueGrant(secondBoot, 0));
  await server.accounts[1].transport.admit(issueGrant(secondBoot, 1));
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
  console.log("PASS: verified two-device MLS, relay restart, old admission blocked, same mailbox after new approval, sender retry, automatic signed receipt, no duplicate.");
} finally {
  devices.forEach(device => device.close());
  await server.stop();
}
