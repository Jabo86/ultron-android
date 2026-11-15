import { bytesToHex, sha256Hex, signMessage, utf8Decode, utf8Encode, verifyMessage } from "./crypto.js";

export const GROUP_CIPHERSUITE = "MLS_256_XWING_AES256GCM_SHA512_MLDSA87";
const CREDENTIAL = "ultron-mls-credential-v1";
const MLS_KEY_BYTES = 2592;
const MAX_CREDENTIAL_BYTES = 7500;
const VALID_ACCOUNT = /^(?=.{3,32}@)[a-z0-9._-]+@ultron\.uns$/;
const isHex = (value, size) => typeof value === "string" && value.length === size && /^[a-f0-9]+$/.test(value);

export function groupIdentityFingerprint(account, key) {
  if (!VALID_ACCOUNT.test(account) || !isHex(key, 3904)) return null;
  return sha256Hex(JSON.stringify(["ultron-mls-identity-v1", account, key]));
}

function fields(server, account, device, publicKey) {
  if (!/^https:\/\/[^\s?#]{1,200}$/.test(server) || !VALID_ACCOUNT.test(account) ||
      !isHex(device, 32) || !(publicKey instanceof Uint8Array) || publicKey.length !== MLS_KEY_BYTES) {
    throw new Error("Invalid ULTRON group credential.");
  }
  return [CREDENTIAL, server, GROUP_CIPHERSUITE, account, device, sha256Hex(bytesToHex(publicKey))];
}

export function signGroupCredential(user, device, publicKey) {
  const transcript = fields(user.server, user.lns, device, publicKey);
  const signature = signMessage(JSON.stringify(transcript), user.sk);
  if (!isHex(signature, 6618)) throw new Error("ULTRON identity key missing.");
  return utf8Encode(JSON.stringify([...transcript, signature]));
}

export function groupAuthenticationService(server, verifiedIdentity) {
  return {
    // The caller supplies QR-verified ULTRON identity keys. The delivery
    // service must never be the trust source for this lookup.
    async validateCredential(credential, publicKey) {
      try {
        if (credential?.credentialType !== "basic" || !(credential.identity instanceof Uint8Array) ||
            credential.identity.length > MAX_CREDENTIAL_BYTES ||
            credential.identity.some(byte => byte < 0x20 || byte > 0x7e)) return false;
        const raw = utf8Decode(credential.identity);
        const signed = JSON.parse(raw);
        if (!Array.isArray(signed) || signed.length !== 7 || JSON.stringify(signed) !== raw) return false;
        const [tag, scope, suite, account, device, hash, signature] = signed;
        if (tag !== CREDENTIAL || scope !== server || suite !== GROUP_CIPHERSUITE || !isHex(signature, 6618)) return false;
        const transcript = fields(scope, account, device, publicKey);
        if (hash !== transcript[5]) return false;
        const identityKey = await verifiedIdentity(account, device);
        return isHex(identityKey, 3904) && verifyMessage(JSON.stringify(transcript), signature, identityKey);
      } catch {
        return false;
      }
    },
  };
}
