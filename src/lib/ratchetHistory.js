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
    envelope.for, envelope.dev, envelope.session_id, r, envelope.init_sig, iv, ct,
    h.v, h.sdev, h.pf, h.xpk, h.pk, h.ct, h.kf, h.n, h.pn,
    init && [init.ct1, init.pk_id, init.epk, init.k, init.sct, init.spk],
  ]));
  return { name: receivedHistoryName(user, message.conv_id, message.message_id, message.from_lns), digest };
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


// Only the source installation can read the copy written before sending.
export function hostedSentRecord(user, peer, sendId) {
  return typeof sendId === "string" && /^[0-9a-f]{32}$/.test(sendId)
    ? "ratchet-sent:" + sha256Hex(JSON.stringify([user.server, user.lns, peer, sendId]))
    : null;
}


export function receivedHistoryName(user, conversation, message, sender) {
  return "ratchet-msg:" + sha256Hex(JSON.stringify([user.server, user.lns, conversation, message, sender]));
}
