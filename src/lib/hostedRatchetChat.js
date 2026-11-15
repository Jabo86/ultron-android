import * as api from "./api";
import { DEFAULT_SERVER, RATCHET_PILOT } from "../config";
import { deviceId } from "./devices";
import { getBlob } from "./lock";
import { getVerified, keyFingerprint } from "./verify";
import { hostedSignedChatKeys } from "./signedChatKeys";
import { parsePools, publishHostedPrekeys } from "./hostedPrekeys";
import { receiveHostedRatchet, sendHostedRatchet } from "./ratchet";
import { archivablePayload, hostedSentRecord } from "./ratchetHistory";

export function hostedRatchetPilot(user) {
  return RATCHET_PILOT && user?.server === DEFAULT_SERVER && api.getServerUrl() === DEFAULT_SERVER;
}

export async function verifiedContact(user, peer) {
  const pinned = await getVerified(peer);
  if (!pinned) throw new Error("Verifica il QR del contatto per usare il ratchet pilota.");
  const signed = await hostedSignedChatKeys(user.lns, peer, (kem, dh) => {
    if (keyFingerprint(peer, kem, dh) !== pinned.fp) throw new Error("Le chiavi verificate del contatto sono cambiate.");
  });
  if (!signed) throw new Error("Le chiavi firmate del contatto non sono disponibili.");
  return signed;
}

export async function registerHostedRatchet(user) {
  if (!hostedRatchetPilot(user)) return;
  return publishHostedPrekeys(user, await deviceId());
}

export async function sendPilotMessage(payload, user, peer) {
  if (!archivablePayload(payload)) throw new Error("La prova ratchet supporta i messaggi senza scadenza.");
  const check = api.authenticatedScope(user);
  const device = await deviceId();
  const active = await publishHostedPrekeys(user, device);
  check();
  const mine = parsePools(await api.hostedPrekeyPools(user.lns));
  if (mine.length !== 1 || mine[0].device !== active) {
    throw new Error("La prova ratchet richiede un solo dispositivo per account.");
  }
  const keys = await verifiedContact(user, peer);
  check();
  return sendHostedRatchet(payload, user, peer, device, keys);
}

export async function readPilotMessage(message, user) {
  if (!hostedRatchetPilot(user) || !message.ratchet) return null;
  const check = api.authenticatedScope(user);
  if (message.mine) {
    if (message.from_lns !== user.lns) return null;
    const name = hostedSentRecord(user, message.to_lns, message.send_id);
    const opened = name && await getBlob(name);
    check();
    return typeof opened === "string" ? opened : null;
  }
  const keys = await verifiedContact(user, message.from_lns);
  const installation = await deviceId();
  check();
  return receiveHostedRatchet(message, user, installation, keys.identityKey);
}
