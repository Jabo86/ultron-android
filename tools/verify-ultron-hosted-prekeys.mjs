import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { bytesToHex, hexToBytes, keygen, randomHex, sha256Hex } from "../src/lib/crypto.js";
import { ml_kem768 } from "@noble/post-quantum/ml-kem.js";
import { signPrekey, verifyClaimedPrekey } from "../src/lib/prekeyProof.js";

const user = { server: "https://test.invalid", lns: "a@ultron.uns", sk: keygen().secretKeyHex };
const stored = new Map();
let attempts = [];
let remote = [];
let timeout = true;
let claim;
const api = {
  authenticatedScope: () => () => {},
  hostedPrekeyPools: async () => ({ protocol: 2, devices: remote }),
  hostedPublishPrekeys: async (batch) => {
    attempts.push(structuredClone(batch));
    assert.equal("secretKey" in batch.keys[0], false);
    assert.equal("sec" in batch.keys[0], false);
    assert.ok(stored.get("hosted-prekeys:" + batch.device).privateKeys[batch.keys[0].id].sec);
    if (timeout) throw new Error("timeout");
    remote = [{ device: batch.device, generation: batch.generation, available: batch.keys.length }];
    return { ok: true };
  },
  hostedClaimPrekey: async () => claim,
};
function load(name, variables, exports) {
  const source = readFileSync(new URL("../src/lib/" + name, import.meta.url), "utf8")
    .replace(/^import .*\n/gm, "").replaceAll("export ", "");
  return runInNewContext(source + "\n({" + exports + "})", {setTimeout,...variables});
}
function start() {
  return load("hostedPrekeys.js", {
    api, ml_kem768, bytesToHex, hexToBytes, randomHex, sha256Hex, signPrekey, verifyClaimedPrekey,
    getBlob: async (key) => stored.get(key), setBlobDurably: async (key, value) => { stored.set(key, value); },
  }, "publishHostedPrekeys, claimVerifiedHostedPrekey, parsePools");
}
await assert.rejects(start().publishHostedPrekeys(user, "test-installation"), /timeout/);
timeout = false;
const device = await start().publishHostedPrekeys(user, "test-installation");
assert.deepEqual(attempts[0], attempts[1], "Retry identical signed public batch after restart");
assert.equal(stored.get("hosted-prekeys:" + device).pending, null);
await start().publishHostedPrekeys(user, "test-installation");
assert.equal(attempts.length, 2, "Keep a live batch intact");
remote = [];
await assert.rejects(start().publishHostedPrekeys(user, "test-installation"), /non corrisponde/);
assert.throws(() => start().parsePools({ protocol: 2, devices: [{ device, generation: 1, available: -1 }] }), /non valido/);

const peer = "b@ultron.uns";
const identity = keygen();
const key = signPrekey(peer, device, 1, randomHex(16), "22".repeat(1184), identity.secretKeyHex);
claim = { device, generation: 1, prekey: key };
assert.equal((await start().claimVerifiedHostedPrekey(user, peer, device, identity.publicKeyHex)).id, key.id);
claim.prekey = { ...key, kem: "33".repeat(1184) };
await assert.rejects(start().claimVerifiedHostedPrekey(user, peer, device, identity.publicKeyHex), /non valida/);
claim = { prekey: null };
await assert.rejects(start().claimVerifiedHostedPrekey(user, peer, device, identity.publicKeyHex), /disponibili/);

const modes = new Map();
const AsyncStorage = {
  getItem: async (key) => modes.get(key) ?? null,
  setItem: async (key, value) => { modes.set(key, value); },
};
const policy = () => load("hostedChatPolicy.js", { AsyncStorage, sha256Hex }, "assertHostedLegacyAllowed, requireHostedRatchet");
await policy().assertHostedLegacyAllowed(user, peer);
await policy().requireHostedRatchet(user, peer);
await assert.rejects(policy().assertHostedLegacyAllowed(user, peer), /richiede il ratchet/);
await policy().assertHostedLegacyAllowed(user, "unrelated@ultron.uns");
console.log("ULTRON hosted chat: persisted prekey retries, signed claim checks and sticky downgrade guard verified.");
