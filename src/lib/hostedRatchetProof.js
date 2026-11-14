import { signMessage, verifyMessage } from "./crypto.js";

function initialProof(sender, envelope) {
  const { for: recipient, dev, session_id, r, h, iv, ct } = envelope;
  const { v, sdev, pf, xpk, n, pn, pk, ct: pq, kf, init } = h;
  return "ultron-ratchet-init-v1\n" + JSON.stringify([
    sender, recipient, dev, session_id, r, v, sdev, pf, xpk, n, pn, pk ?? null, pq ?? null, kf ?? null,
    init.ct1, init.pk_id, init.epk, init.k ?? null, iv, ct,
  ]);
}

export function signHostedRatchetInit(sender, envelope, secret) {
  if (!envelope.h?.init?.pk_id || envelope.session_id !== envelope.h.init.pk_id) throw new Error("Inizializzazione ratchet senza prekey.");
  return { ...envelope, init_sig: signMessage(initialProof(sender, envelope), secret) };
}

export function verifyHostedRatchetInit(sender, recipient, device, envelope, identityKey) {
  if (typeof identityKey !== "string" || identityKey.length !== 3904 ||
      typeof envelope?.init_sig !== "string" || envelope.init_sig.length !== 6618 ||
      envelope.for !== recipient || envelope.dev !== device || envelope.r !== 2 || envelope.h?.v !== 2 || envelope.session_id !== envelope.h.init?.pk_id ||
      !/^[0-9a-f]{32}$/.test(envelope.h.sdev) || !/^[0-9a-f]{32}$/.test(envelope.h.init?.pk_id || "")) return false;
  try {
    return verifyMessage(initialProof(sender, envelope), envelope.init_sig, identityKey);
  } catch {
    return false;
  }
}
