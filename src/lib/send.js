// Costruzione delle buste in uscita.
// Il doppio ratchet vale per OGNI destinatario: nelle chat a due e nei gruppi (una busta
// ratchet per ciascun dispositivo di ciascun membro). Chi ha un'app vecchia riceve la busta
// nello schema precedente, così nessuno resta senza messaggi.
import { DEFAULT_SERVER } from "../config";
import { bytesToHex, encryptForRecipients } from "./crypto";
import { getVerified, keyFingerprint } from "./verify";
import { addSelfKeys } from "./devices";
import { ratchetEnvelopesFor } from "./ratchet";
import * as api from "./api";

export async function buildEnvelopes(payload, others, user) {
  // The hosted gateway exposes static ML-KEM keys for individual chat.
  if (others.length === 1 && api.getServerUrl() === DEFAULT_SERVER) {
    const [peer] = others;
    const pinned = await getVerified(peer);
    const [keys, dhKeys] = await Promise.all([
      api.pulseStaticKeys([peer]), pinned ? api.pulseDhKeys([peer]) : null,
    ]);
    if (pinned && (!dhKeys?.[peer] || keyFingerprint(peer, keys?.[peer] || "", dhKeys[peer]) !== pinned.fp)) {
      throw new Error("Le chiavi del contatto verificato sono cambiate. Verifica di nuovo il QR prima di inviare.");
    }
    if (!keys?.[peer]) throw new Error(peer);
    return encryptForRecipients(payload, { [peer]: keys[peer], [user.lns]: bytesToHex(user.kem.publicKey) });
  }

  const envelopes = [];
  const keyMap = {};
  for (const peer of others) {
    let r = { envelopes: [], legacy: [] };
    try { r = await ratchetEnvelopesFor(payload, peer, user); } catch { /* si ripiega sotto */ }
    envelopes.push(...r.envelopes);
    if (r.legacy.length) keyMap[peer] = r.legacy;
    if (!r.envelopes.length && !r.legacy.length) {
      const km = await api.pulseKeys([peer]);
      if (km && km[peer]) keyMap[peer] = km[peer];
    }
  }
  await addSelfKeys(keyMap, user); // le mie copie restano sulle chiavi usa-e-getta
  if (Object.keys(keyMap).length) envelopes.push(...encryptForRecipients(payload, keyMap));

  const covered = new Set(envelopes.map((e) => e.for));
  const missing = others.filter((o) => !covered.has(o));
  if (missing.length) throw new Error(missing.join(", "));
  return envelopes;
}
