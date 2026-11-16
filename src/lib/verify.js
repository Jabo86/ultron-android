// Verifica contatto (anti man-in-the-middle): impronta delle chiavi, numero di sicurezza a 60
// cifre e codice QR. Tutto calcolato sul telefono: il server non partecipa alla verifica e non
// sa quali contatti hai verificato (lo stato resta solo in locale).
import AsyncStorage from "@react-native-async-storage/async-storage";
import { sha3_256 } from "@noble/hashes/sha3.js";
import { RATCHET_PILOT } from "../config";
import { getBlob, setBlobDurably } from "./lock";
import { bytesToHex, hexToBytes, sha256Hex } from "./crypto";
import * as api from "./api";

const ITER = 600; // rende inutile una ricerca di collisioni sul numero corto
export const QR_PREFIX = "LATTICE1";

function enc8(s) {
  const a = [];
  const str = String(s || "");
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    if (c < 128) a.push(c);
    else if (c < 2048) a.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    else a.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
  }
  return new Uint8Array(a);
}

// Impronta di un'identità: dipende dall'indirizzo Lattice e dalle chiavi pubbliche con cui
// vengono davvero cifrati i messaggi (ML-KEM statica + X25519 del rendezvous).
export function keyFingerprint(lns, kemPkHex, dhPkHex) {
  const label = enc8("lattice-fp-v1:" + String(lns || "").toLowerCase() + ":");
  const kem = hexToBytes(kemPkHex || "");
  const dh = hexToBytes(dhPkHex || "");
  const base = new Uint8Array(label.length + kem.length + dh.length);
  base.set(label, 0);
  base.set(kem, label.length);
  base.set(dh, label.length + kem.length);
  const buf = new Uint8Array(32 + base.length);
  buf.set(base, 32);
  let h = sha3_256(base);
  for (let i = 1; i < ITER; i++) {
    buf.set(h, 0);
    h = sha3_256(buf);
  }
  return bytesToHex(h);
}

// 30 cifre da un'impronta (6 gruppi di 5 cifre, come i safety number di Signal).
export function fpDigits(fpHex) {
  const b = hexToBytes(fpHex || "");
  let out = "";
  for (let i = 0; i < 6; i++) {
    let n = 0;
    for (let j = 0; j < 5; j++) n = n * 256 + (b[i * 5 + j] || 0);
    out += String(n % 100000).padStart(5, "0");
  }
  return out;
}

// Numero di sicurezza condiviso: identico sui due telefoni (ordine deterministico).
export function safetyNumber(myFp, peerFp) {
  if (!myFp || !peerFp) return "";
  const pair = [myFp, peerFp].sort();
  return fpDigits(pair[0]) + fpDigits(pair[1]);
}

export function digitGroups(num) {
  return String(num || "").match(/.{1,5}/g) || [];
}

const GROUP_QR_PREFIX = "ULTRON2";

export function qrPayload(lns, fpHex, identityFp) {
  const short = String(fpHex || "").slice(0, 40);
  return identityFp
    ? [GROUP_QR_PREFIX, lns, short, identityFp].join(":")
    : [QR_PREFIX, lns, short].join(":");
}

export function parseQr(raw) {
  const [version, lns, encryptionFp, identityFp, ...rest] = String(raw || "").trim().split(":");
  if (!/^[0-9a-f]{40}$/i.test(encryptionFp || "") || rest.length) return null;
  const fp40 = encryptionFp.toLowerCase();
  if (version === QR_PREFIX && identityFp === undefined) return { lns, fp40 };
  if (version === GROUP_QR_PREFIX && /^[0-9a-f]{64}$/.test(identityFp || "")) return { lns, fp40, identityFp };
  return null;
}

export function myFingerprint(user) {
  if (!user || !user.kem || !user.dh) return "";
  return keyFingerprint(user.lns, bytesToHex(user.kem.publicKey), bytesToHex(user.dh.publicKey));
}

// Impronta del contatto ricavata dalle chiavi che il server ci consegna: se combacia con
// quella mostrata dal suo telefono (QR o numero), nessuno si è messo in mezzo.
export async function peerFingerprint(lns) {
  const kemMap = await api.pulseStaticKeys([lns]);
  const raw = kemMap ? kemMap[lns] : null;
  const kem = Array.isArray(raw) ? (raw[0] && (raw[0].kem_pub || raw[0])) || "" : raw || "";
  if (!kem) throw new Error("Chiave pubblica del contatto non disponibile.");
  let dh = "";
  try {
    const d = await api.pulseDhKeys([lns]);
    dh = (d && d[lns]) || "";
  } catch { /* il DH manca sugli account più vecchi: l'impronta usa solo ML-KEM */ }
  return { fp: keyFingerprint(lns, kem, dh), kem, dh };
}

const K = (lns) => "vfy:" + String(lns || "");

let verificationScope = null;
let verificationWrites = Promise.resolve();

export function setVerificationScope(user) {
  verificationScope = user
    ? "verified-contacts:" + sha256Hex(JSON.stringify([user.server, user.lns]))
    : null;
}

function mutatePilotVerification(change) {
  const scope = verificationScope;
  const task = verificationWrites.then(async () => {
    if (!scope || scope !== verificationScope) throw new Error("Riapri il profilo per verificare questo contatto.");
    const all = (await getBlob(scope)) || {};
    if (scope !== verificationScope) throw new Error("Il profilo è cambiato.");
    change(all);
    await setBlobDurably(scope, all);
  });
  verificationWrites = task.catch(() => {});
  return task;
}

export async function getVerified(lns) {
  if (RATCHET_PILOT) {
    const scope = verificationScope;
    const all = scope ? await getBlob(scope) : null;
    return scope === verificationScope ? all?.[lns] || null : null;
  }
  try {
    const s = await AsyncStorage.getItem(K(lns));
    return s ? JSON.parse(s) : null;
  } catch { return null; }
}
export async function setVerified(lns, fp, method, identityFp) {
  const record = { fp, at: new Date().toISOString(), method: method || "qr" };
  if (RATCHET_PILOT) {
    await mutatePilotVerification((all) => {
      const previous = all[lns];
      const pin = identityFp || (previous?.fp === fp ? previous.identityFp : null);
      if (method === "qr" && /^[0-9a-f]{64}$/.test(pin || "")) record.identityFp = pin;
      else if (previous?.fp === fp && previous.identityFp) record.identityFp = previous.identityFp;
      all[lns] = record;
    });
    return record;
  }
  try { await AsyncStorage.setItem(K(lns), JSON.stringify(record)); } catch { /* */ }
  return record;
}
/// Chi è stato verificato, su questo telefono. Serve al pulsante "Dopo la dogana" per
/// ricontrollare tutte le impronte in un colpo.
export async function verifiedList() {
  if (RATCHET_PILOT) {
    const scope = verificationScope;
    const all = scope ? await getBlob(scope) : null;
    return scope === verificationScope ? Object.keys(all || {}) : [];
  }
  try {
    const keys = await AsyncStorage.getAllKeys();
    return (keys || []).filter((k) => k.startsWith("vfy:")).map((k) => k.slice(4)).filter(Boolean);
  } catch { return []; }
}

export async function clearVerified(lns) {
  if (RATCHET_PILOT) return mutatePilotVerification((all) => { delete all[lns]; });
  try { await AsyncStorage.removeItem(K(lns)); } catch { /* */ }
}

// "none" = mai verificato · "ok" = verificato e chiavi invariate · "changed" = chiavi cambiate
// dopo la verifica (da rifare!) · "unknown" = chiavi non raggiungibili adesso.
export async function verifyState(lns) {
  const rec = await getVerified(lns);
  if (!rec) return { state: "none" };
  try {
    const { fp } = await peerFingerprint(lns);
    return { state: fp === rec.fp ? "ok" : "changed", at: rec.at, fp, savedFp: rec.fp };
  } catch {
    return { state: "unknown", at: rec.at, savedFp: rec.fp };
  }
}
