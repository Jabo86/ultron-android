// CIFRATURA DEL BACKUP (parte pura, provabile in Node).
//
// v2 (2026-11): scrypt N=2^16 (prima 2^14, quattro volte piu' costoso da forzare) e una
// frase d'accesso lunga OBBLIGATORIA. Il KDF da solo non salva una password corta: la
// protezione vera e' l'entropia della frase. Per questo il PIN a 4-10 cifre non e' piu'
// accettato per CREARE un backup; resta valido solo per APRIRE i backup vecchi.
// I backup gia' fatti si aprono ancora: i parametri (N, r, p) stanno nel file stesso.
import { scrypt } from "@noble/hashes/scrypt.js";
import { gcm } from "@noble/ciphers/aes.js";
import { hexToBytes, randomHex, bytesToBase64, base64ToBytes } from "./crypto";

export const FMT = "lattice-backup-1";
export const KDF = { N: 1 << 16, r: 8, p: 1 };
export const MIN_PASSPHRASE = 12;
const MAX_N = 1 << 20; // un file ostile non puo' farci allocare gigabyte

/// null se la frase va bene, altrimenti il motivo (in italiano).
export function passphraseProblem(pw) {
  const s = String(pw || "");
  if (s.length < MIN_PASSPHRASE) return "La frase d'accesso del backup deve avere almeno " + MIN_PASSPHRASE + " caratteri.";
  if (/^\d+$/.test(s)) return "Una frase fatta solo di cifre e' troppo debole: aggiungi lettere o usa piu' parole.";
  if (new Set(s).size < 6) return "Troppi caratteri ripetuti: scegli una frase piu' varia.";
  if (/^pin:/i.test(s)) return "Il PIN non basta per cifrare un backup: scegli una frase lunga.";
  return null;
}

export function enc8(str) {
  const out = [];
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    else if (c >= 0xd800 && c <= 0xdbff) {
      const c2 = s.charCodeAt(++i);
      const cp = 0x10000 + ((c & 0x3ff) << 10) + (c2 & 0x3ff);
      out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    } else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
  }
  return new Uint8Array(out);
}
export function dec8(bytes) {
  const codes = [];
  let i = 0;
  while (i < bytes.length) {
    const c = bytes[i++];
    if (c < 0x80) codes.push(c);
    else if (c < 0xe0) codes.push(((c & 0x1f) << 6) | (bytes[i++] & 0x3f));
    else if (c < 0xf0) codes.push(((c & 0x0f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f));
    else {
      const cp = ((c & 0x07) << 18) | ((bytes[i++] & 0x3f) << 12) | ((bytes[i++] & 0x3f) << 6) | (bytes[i++] & 0x3f);
      const v = cp - 0x10000;
      codes.push(0xd800 + (v >> 10), 0xdc00 + (v & 0x3ff));
    }
  }
  let s = "";
  for (let j = 0; j < codes.length; j += 8192) s += String.fromCharCode.apply(null, codes.slice(j, j + 8192));
  return s;
}

// ── Container cifrato ──
export function encryptContainer(payload, password, hint) {
  const salt = randomHex(16);
  const key = scrypt(enc8(password), hexToBytes(salt), { N: KDF.N, r: KDF.r, p: KDF.p, dkLen: 32 });
  const iv = randomHex(12);
  const ct = gcm(key, hexToBytes(iv)).encrypt(enc8(JSON.stringify(payload)));
  return {
    fmt: FMT, at: payload.at, lns: payload.lns, hint: hint || "password",
    kdf: { alg: "scrypt", N: KDF.N, r: KDF.r, p: KDF.p, salt },
    iv, ct: bytesToBase64(ct),
  };
}

export function decryptContainer(container, password) {
  if (!container || container.fmt !== FMT) throw new Error("Questo file non è un backup ULTRON.");
  const k = container.kdf || {};
  // Un backup vecchio porta i SUOI parametri (anche 2^14): si usano quelli. Mai niente fuori scala.
  const N = Number(k.N) || (1 << 14), r = Number(k.r) || 8, p = Number(k.p) || 1;
  if (N < 2 || (N & (N - 1)) !== 0 || N > MAX_N || r < 1 || r > 16 || p < 1 || p > 4) throw new Error("Il file di backup ha parametri non validi.");
  const key = scrypt(enc8(password), hexToBytes(k.salt || ""), { N, r, p, dkLen: 32 });
  let pt;
  try {
    pt = gcm(key, hexToBytes(container.iv)).decrypt(base64ToBytes(container.ct));
  } catch {
    throw new Error("Password errata (oppure il file è danneggiato).");
  }
  return JSON.parse(dec8(pt));
}
