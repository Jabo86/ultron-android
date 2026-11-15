import { sha256 } from "@noble/hashes/sha2.js";
import { hexToBytes, randomHex } from "./crypto.js";
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
