// Costruzione delle buste in uscita.
// Il doppio ratchet vale per OGNI destinatario: nelle chat a due e nei gruppi (una busta
// ratchet per ciascun dispositivo di ciascun membro). Chi ha un'app vecchia riceve la busta
// nello schema precedente, così nessuno resta senza messaggi.
import { DEFAULT_SERVER } from "../config";
import { bytesToHex, encryptForRecipients } from "./crypto";
import { getVerified, keyFingerprint } from "./verify";
import { addSelfKeys } from "./devices";
import { ratchetEnvelopesFor } from "./ratchet";
import { assertHostedLegacyAllowed } from "./hostedChatPolicy";
import { hostedSignedChatKeys } from "./signedChatKeys";
import { hostedRatchetPilot, sendPilotMessage } from "./hostedRatchetChat";
import * as api from "./api";

export async function buildEnvelopes(payload, others, user) {
  // The hosted gateway exposes static ML-KEM keys for individual chat.
  if (others.length === 1 && api.getServerUrl() === DEFAULT_SERVER) {
    const [peer] = others;
    await assertHostedLegacyAllowed(user, peer);
    const pinned = await getVerified(peer);
    const validateKeys = (kem, dh) => {
      if (pinned && (!dh || keyFingerprint(peer, kem || "", dh) !== pinned.fp)) {
        throw new Error("Le chiavi del contatto verificato sono cambiate. Verifica di nuovo il QR prima di inviare.");
      }
    };
    const signed = await hostedSignedChatKeys(user.lns, peer, validateKeys);
    let kem = signed?.kem;
    if (!signed) {
      const [keys, dhKeys] = await Promise.all([
        api.pulseStaticKeys([peer]), pinned ? api.pulseDhKeys([peer]) : null,
      ]);
      kem = keys?.[peer];
      validateKeys(kem, dhKeys?.[peer]);
    }
    if (!kem) throw new Error(peer);
    await assertHostedLegacyAllowed(user, peer);
    return encryptForRecipients(payload, { [peer]: kem, [user.lns]: bytesToHex(user.kem.publicKey) });
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


export async function sendChatMessage(payload, others, user) {
  if (others.length === 1 && hostedRatchetPilot(user)) {
    return sendPilotMessage(payload, user, others[0]);
  }
  const envelopes = await buildEnvelopes(payload, others, user);
  return api.send({ to_lns: others, envelopes });
}
