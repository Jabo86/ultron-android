// Proof shared with the gateway for one-time ML-KEM public keys.
import { signMessage, verifyMessage } from "./crypto.js";

const hex = (value, length) => typeof value === "string" &&
  value.length === length && /^[0-9a-f]+$/.test(value);

export function prekeyProof(owner, device, generation, id, kem) {
  if (!hex(device, 32) || !Number.isSafeInteger(generation) || generation < 1 ||
      !hex(id, 32) || !hex(kem, 2368) || !/^[a-z0-9._-]+@[a-z0-9._-]+$/.test(owner)) {
    throw new Error("Prekey non valida.");
  }
  return `ultron-prekey-v1\n${owner}\n${device}\n${generation}\n${id}\n${kem}`;
}

export function signPrekey(owner, device, generation, id, kem, secret) {
  return { id, kem, signature: signMessage(prekeyProof(owner, device, generation, id, kem), secret) };
}

export function verifyClaimedPrekey(owner, device, claim, identityKey) {
  if (!claim || claim.device !== device || !claim.prekey || !hex(identityKey, 3904)) return false;
  const { id, kem, signature } = claim.prekey;
  if (!hex(signature, 6618)) return false;
  try {
    return verifyMessage(prekeyProof(owner, device, claim.generation, id, kem), signature, identityKey);
  } catch {
    return false;
  }
}
