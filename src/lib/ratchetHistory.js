import { sha256Hex } from "./crypto.js";

const validId = (id) => typeof id === "string" && /^[0-9a-f]{24,64}$/.test(id);

// A saved plaintext belongs to one envelope, account and server. The digest
// also covers decryption headers, so a replaced envelope cannot hit the cache.
export function historyRecord(user, message, envelope) {
  if (!user?.server || !user.lns || !message?.from_lns ||
      !validId(message.conv_id) || !validId(message.message_id) || !envelope?.h) return null;
  const { h, iv, ct, r } = envelope;
  const { init } = h;
  const digest = sha256Hex(JSON.stringify([
    envelope.for, envelope.dev, r, iv, ct,
    h.v, h.sdev, h.pf, h.xpk, h.pk, h.ct, h.kf, h.n, h.pn,
    init && [init.ct1, init.pk_id, init.epk, init.k, init.sct, init.spk],
  ]));
  const id = sha256Hex(JSON.stringify([user.server, user.lns, message.conv_id, message.message_id, message.from_lns]));
  return { name: "ratchet-msg:" + id, digest };
}

export function archivablePayload(plaintext) {
  try {
    const payload = JSON.parse(plaintext);
    return payload?.__lat === 1 && payload.ttl === 0 &&
      typeof payload.t === "string" && !payload.t.startsWith("\u0001");
  } catch {
    return false;
  }
}
