import { argon2idAsync } from "@noble/hashes/argon2.js";
import { bytesToHex, hexToBytes } from "./crypto.js";

const PARAMETERS = { m: 65536, t: 3, p: 1, dkLen: 32 };
let nativeDerivation = null;

export function setNativeExportKdf(module) {
  if (typeof module?.deriveExportKey === "function") nativeDerivation = module;
}

export async function deriveExportKey(secret, salt) {
  if (!nativeDerivation) return argon2idAsync(secret, salt, PARAMETERS);
  const key = await nativeDerivation.deriveExportKey(bytesToHex(secret), bytesToHex(salt));
  if (!/^[0-9a-f]{64}$/.test(key)) throw new Error("Invalid native key derivation result");
  return hexToBytes(key);
}
