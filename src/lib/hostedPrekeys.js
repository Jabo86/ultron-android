import { ml_kem768 } from "@noble/post-quantum/ml-kem.js";
import * as api from "./api";
import { bytesToHex, hexToBytes, randomHex, sha256Hex } from "./crypto";
import { getBlob, setBlobDurably } from "./lock";
import { signPrekey, verifyClaimedPrekey } from "./prekeyProof";

const BATCH_SIZE = 16;
// Keep all issued private keys until the matching envelope has been opened.
const MAX_PRIVATE = 128;
let writes = Promise.resolve();

export function parsePools(reply) {
  if (reply?.protocol !== 2 || !Array.isArray(reply.devices) || reply.devices.length > 8 ||
      reply.devices.some((pool) => !/^[0-9a-f]{32}$/.test(pool?.device) ||
        !Number.isSafeInteger(pool.generation) || pool.generation < 1 ||
        !Number.isSafeInteger(pool.available) || pool.available < 0 || pool.available > 32) ||
      new Set(reply.devices.map((item) => item.device)).size !== reply.devices.length) {
    throw new Error("Registro prekey non valido.");
  }
  return reply.devices;
}

export function publishHostedPrekeys(user, installation) {
  const checkScope = api.authenticatedScope(user);
  const job = writes.then(async () => {
    checkScope();
    if (typeof installation !== "string" || !installation) throw new Error("Dispositivo ULTRON non identificato.");
    const device = sha256Hex(JSON.stringify([user.server, user.lns, installation])).slice(0, 32);
    const name = "hosted-prekeys:" + device;
    const state = (await getBlob(name)) || { generation: 0, privateKeys: {} };
    checkScope();
    const pools = parsePools(await api.hostedPrekeyPools(user.lns));
    const remote = pools.find((pool) => pool.device === device);
    checkScope();
    const generation = remote?.generation || 0;
    if (generation > state.generation ||
        (generation < state.generation && (!state.pending || state.generation !== generation + 1))) {
      throw new Error("Il registro prekey non corrisponde alle chiavi locali.");
    }
    if (remote?.available && generation === state.generation) {
      if (state.pending) await setBlobDurably(name, { ...state, pending: null });
      checkScope();
      return device;
    }
    let pending = state.pending;
    let privateKeys = state.privateKeys;
    if (!pending || generation === state.generation) {
      privateKeys = { ...state.privateKeys };
      if (Object.keys(privateKeys).length + BATCH_SIZE > MAX_PRIVATE) {
        throw new Error("Troppe prekey in attesa dei relativi messaggi.");
      }
      const next = state.generation + 1;
      const keys = Array.from({ length: BATCH_SIZE }, () => {
        const pair = ml_kem768.keygen(hexToBytes(randomHex(64)));
        const id = randomHex(16);
        const kem = bytesToHex(pair.publicKey);
        privateKeys[id] = { pub: kem, sec: bytesToHex(pair.secretKey) };
        pair.secretKey.fill(0);
        return signPrekey(user.lns, device, next, id, kem, user.sk);
      });
      pending = { device, generation: next, keys };
      checkScope();
      await setBlobDurably(name, { generation: next, privateKeys, pending });
    }
    checkScope();
    // An interrupted network request is retried with exactly the same signed batch.
    const response = await api.hostedPublishPrekeys(pending);
    if (response?.ok !== true) throw new Error("Il gateway non ha confermato le prekey.");
    checkScope();
    await setBlobDurably(name, { generation: pending.generation, privateKeys, pending: null });
    checkScope();
    return device;
  });
  writes = job.catch(() => {});
  return job;
}

export async function claimVerifiedHostedPrekey(user, peer, device, identityKey) {
  const checkScope = api.authenticatedScope(user);
  const claim = await api.hostedClaimPrekey(peer, device);
  checkScope();
  if (claim?.prekey === null) throw new Error("Il contatto non ha prekey disponibili.");
  if (!verifyClaimedPrekey(peer, device, claim, identityKey)) {
    throw new Error("Firma della prekey del contatto non valida.");
  }
  return claim.prekey;
}
