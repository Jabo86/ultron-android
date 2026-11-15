import { sha256 } from "@noble/hashes/sha2.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { hexToBytes, randomHex, keygenFromSeed, utf8Encode } from "./crypto.js";
import words from "./recoveryWords.js";

export function phraseFromEntropy(entropy) {
  if (entropy.length !== 16) throw new Error("Expected 128 bits of entropy.");
  const bytes = new Uint8Array(17);
  bytes.set(entropy);
  bytes[16] = sha256(entropy)[0];
  const phrase = [];
  for (let index = 0; index < 132; index += 11) {
    const offset = index >> 3;
    const shift = 13 - (index & 7);
    const bits = (bytes[offset] << 16) | (bytes[offset + 1] << 8) | (bytes[offset + 2] || 0);
    phrase.push(words[(bits >> shift) & 2047]);
  }
  bytes.fill(0);
  return phrase.join(" ");
}

export function generateRecoveryPhrase() {
  const entropy = hexToBytes(randomHex(16));
  try { return phraseFromEntropy(entropy); }
  finally { entropy.fill(0); }
}

export function recoveryKeyfile(address, server, phrase) {
  const username = address.trim().toLowerCase().replace(/@ultron\.uns$/, "");
  if (!/^[a-z0-9._-]{3,32}$/.test(username) || !/[a-z0-9]/.test(username)) throw new Error("Invalid ULTRON account.");
  const lns = username + "@ultron.uns";
  const tokens = phrase.trim().toLowerCase().split(/\s+/);
  if (tokens.length !== 12 || !/^https:\/\/[^\s?#]+$/.test(server)) throw new Error("Invalid recovery input.");
  const bits = tokens.map((token) => {
    const index = words.indexOf(token);
    if (index < 0) throw new Error("Unknown recovery word.");
    return index.toString(2).padStart(11, "0");
  }).join("");
  const entropy = Uint8Array.from(bits.slice(0, 128).match(/.{8}/g), (byte) => parseInt(byte, 2));
  let seed;
  try {
    if (phraseFromEntropy(entropy) !== tokens.join(" ")) throw new Error("Invalid recovery checksum.");
    const context = utf8Encode(JSON.stringify(["ultron-account-recovery-v1", server, lns]));
    seed = hkdf(sha256, entropy, undefined, context, 32);
    const kp = keygenFromSeed(seed);
    return {
      version: 1, algorithm: "ML-DSA-65", lns_name: lns, server_url: server,
      public_key_hex: kp.publicKeyHex, secret_key_hex: kp.secretKeyHex,
    };
  } finally {
    entropy.fill(0);
    seed?.fill(0);
  }
}
