import { clearDirectPolls } from "./directPollStore";
import { clearAttachmentCache } from "./attachmentCache";
import * as api from "./api";
import * as convCache from "./convCache";
import * as msgCache from "./msgCache";
import { sha256Hex } from "./crypto";
import { deviceId } from "./devices";
import { getBlob, setBlobDurably } from "./lock";
import { dropPurgedRatchet } from "./ratchet";
import { hostedSentRecord, receivedHistoryName } from "./ratchetHistory";

const jobs = new Map();
const checks = new Map();
const valid = (value) => Number.isSafeInteger(value) && value >= 0;
const key = (user, peer) => "purge:" + sha256Hex(JSON.stringify([user.server, user.lns, peer]));

async function clearDeleted(user, peer, status, state) {
  if (!valid(status.generation) || !/^[0-9a-f]{64}$/.test(status.conv_id || "")) {
    throw new Error("Il gateway non ha confermato lo stato della chat.");
  }
  const from = state.done ?? 0;
  if (status.generation <= from) return state;
  const check = api.authenticatedScope(user);
  const names = new Set();
  let after;
  let completedGeneration = status.generation;
  do {
    check();
    const page = await api.pilotPurgeStatus(peer, { from, after });
    if (page.conv_id !== status.conv_id || !valid(page.generation) || !Array.isArray(page.items)) {
      throw new Error("Ricevuta di eliminazione non valida.");
    }
    completedGeneration = Math.min(page.generation, completedGeneration);
    for (const item of page.items) {
      if (item.attachment) continue;
      if (!/^[0-9a-f]{24}$/.test(item.id || "") || ![user.lns, peer].includes(item.sender)) {
        throw new Error("Ricevuta di eliminazione non valida.");
      }
      names.add(item.sender === user.lns
        ? hostedSentRecord(user, peer, item.send_id)
        : receivedHistoryName(user, status.conv_id, item.id, item.sender));
    }
    after = page.next;
  } while (after);
  check();
  msgCache.drop(status.conv_id);
  await convCache.drop(status.conv_id, user, { strict: true });
  await dropPurgedRatchet(user, peer, await deviceId(), completedGeneration, names);
  await clearAttachmentCache();
  await clearDirectPolls(user, peer);
  check();
  const updated = { done: completedGeneration };
  await setBlobDurably(key(user, peer), updated);
  return updated;
}

function serial(user, peer, operation) {
  const name = key(user, peer);
  const task = (jobs.get(name) || Promise.resolve()).catch(() => {}).then(() => operation(name));
  jobs.set(name, task);
  return task.finally(() => { if (jobs.get(name) === task) jobs.delete(name); });
}

export function checkPilotChat(user, peer) {
  const checkKey = key(user, peer);
  if (checks.has(checkKey)) return checks.get(checkKey);
  const task = serial(user, peer, async (name) => {
    const check = api.authenticatedScope(user);
    const state = await getBlob(name) || {};
    check();
    const status = await api.pilotPurgeStatus(peer).catch(error => {
      if (error?.response?.status === 404 && !state.done && state.request === undefined) return null;
      throw error;
    });
    check();
    if (!status) return null;
    await clearDeleted(user, peer, status, state);
    return status;
  });
  checks.set(checkKey, task);
  return task.finally(() => { if (checks.get(checkKey) === task) checks.delete(checkKey); });
}

export function deletePilotChat(user, peer, convId) {
  checks.delete(key(user, peer));
  return serial(user, peer, async (name) => {
    const check = api.authenticatedScope(user);
    const state = await getBlob(name) || {};
    check();
    if (state.request === undefined) {
      const status = await api.pilotPurgeStatus(peer);
      if (!valid(status.generation) || status.conv_id !== convId) throw new Error("Conversazione non valida.");
      state.request = status.generation;
      check();
      await setBlobDurably(name, state);
    }
    const result = await api.pilotPurgeChat(peer, state.request);
    check();
    if (result?.purged !== true || result.conv_id !== convId || result.generation !== state.request + 1) {
      throw new Error("Il gateway non ha confermato l’eliminazione definitiva.");
    }
    await clearDeleted(user, peer, result, state);
  });
}
