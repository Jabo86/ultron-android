import { deriveExportKey } from "./exportKdf.js";
import { gcm } from "@noble/ciphers/aes.js";
import { parseKeyfile, randomHex, hexToBytes, bytesToHex, utf8Encode, utf8Decode } from "./crypto.js";

export const KEYFILE_FORMAT = "ultron-encrypted-key-v1";
export const MIN_KEY_PASSWORD = 16;
export const MAX_KEY_PASSWORD = 256;
export const MAX_KEYFILE_BYTES = 128 * 1024;

const CONTEXT = utf8Encode(KEYFILE_FORMAT);
const isHex = (value, length) => typeof value === "string" &&
  value.length === length && /^[0-9a-f]+$/i.test(value);

async function derive(password, salt) {
  const secret = utf8Encode(password);
  try { return await deriveExportKey(secret, hexToBytes(salt)); }
  finally { secret.fill(0); }
}

export async function protectKeyfile(keyfile, password) {
  if (!parseKeyfile(keyfile)) throw new Error("Invalid keyfile");
  if (password.length < MIN_KEY_PASSWORD || password.length > MAX_KEY_PASSWORD) {
    throw new Error("Invalid password length");
  }
  const salt = randomHex(16);
  const iv = randomHex(12);
  const plain = utf8Encode(JSON.stringify(keyfile));
  let key;
  try {
    if (plain.length > MAX_KEYFILE_BYTES / 2 - 256) throw new Error("Keyfile too large");
    key = await derive(password, salt);
    const ct = gcm(key, hexToBytes(iv), CONTEXT).encrypt(plain);
    return { fmt: KEYFILE_FORMAT, salt, iv, ct: bytesToHex(ct) };
  } finally {
    plain.fill(0);
    key?.fill(0);
  }
}

export async function openProtectedKeyfile(container, password) {
  if (container?.fmt !== KEYFILE_FORMAT || !isHex(container.salt, 32) || !isHex(container.iv, 24) ||
      typeof container.ct !== "string" || container.ct.length < 32 ||
      container.ct.length > MAX_KEYFILE_BYTES - 256 || container.ct.length % 2 !== 0 ||
      !isHex(container.ct, container.ct.length) || !password || password.length > MAX_KEY_PASSWORD) {
    throw new Error("Invalid encrypted keyfile");
  }
  let key, plain;
  try {
    key = await derive(password, container.salt);
    plain = gcm(key, hexToBytes(container.iv), CONTEXT).decrypt(hexToBytes(container.ct));
    const keyfile = JSON.parse(utf8Decode(plain));
    if (!parseKeyfile(keyfile)) throw new Error("Invalid keyfile");
    return keyfile;
  } finally {
    plain?.fill(0);
    key?.fill(0);
  }
}
