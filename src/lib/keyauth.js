// CHIAVI FIRMATE — il telefono controlla che il server non sostituisca le chiavi di un contatto.
//
// Ogni utente firma con la sua identita' (ML-DSA-65) le chiavi con cui si cifra per lui.
// Chi scrive:
//  1. riceve dal server chiavi, firma e chiave di firma del contatto;
//  2. controlla la firma; se e' sbagliata, NON invia;
//  3. alla prima volta ricorda la chiave di firma del contatto (TOFU); se in seguito il server ne
//     mostra un'altra, NON invia: o il contatto ha cambiato identita' o qualcuno sta sostituendo
//     le chiavi. Il numero di sicurezza (verifica QR) resta il modo per avere certezza alla prima volta;
//  4. se un contatto ha gia' firmato in passato, ma ora il server mostra chiavi senza firma,
//     NON invia (protezione dal ritorno a uno schema senza firma).
// Un contatto con app vecchia, mai visto firmare, continua a funzionare come prima.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { verifyMessage } from "./crypto";
import * as api from "./api";

const K = (lns) => "ka:" + String(lns || "").toLowerCase();

export function keyMessage(lns, kem, dh) {
  return `lattice-keys-v1\n${String(lns).toLowerCase()}\n${String(kem).toLowerCase()}\n${String(dh).toLowerCase()}`;
}

async function getPin(lns) {
  try { const s = await AsyncStorage.getItem(K(lns)); return s ? JSON.parse(s) : null; } catch { return null; }
}
async function setPin(lns, pk) {
  try { await AsyncStorage.setItem(K(lns), JSON.stringify({ pk, at: new Date().toISOString(), signed: true })); } catch { /* */ }
}
/// Dopo un cambio di identita' voluto e verificato di persona, si riparte da zero.
export async function forget(lns) { try { await AsyncStorage.removeItem(K(lns)); } catch { /* */ } }

/// Decisione pura (testabile): `rec` e' quello che dice il server, `pin` quello ricordato.
/// Ritorna { ok, reason, pin } — `pin` e' la chiave di firma da ricordare, se nuova.
export function decide(lns, rec, pin, verify = verifyMessage) {
  if (!rec || !rec.kem || !rec.dh) return { ok: true, reason: "nessun dato: si lascia al controllo gia' esistente" };
  const signed = !!(rec.sig && rec.pk);
  if (!signed) {
    if (pin && pin.signed) return { ok: false, reason: "Il server mostra chiavi senza firma per un contatto che prima firmava. Invio bloccato." };
    return { ok: true, reason: "contatto senza firma (app vecchia)" };
  }
  if (!verify(keyMessage(lns, rec.kem, rec.dh), rec.sig, rec.pk)) {
    return { ok: false, reason: "La firma delle chiavi del contatto non e' valida. Invio bloccato." };
  }
  if (pin && pin.pk && pin.pk !== rec.pk) {
    return { ok: false, reason: "L'identita' del contatto e' cambiata. Verifica di nuovo il numero di sicurezza prima di scrivere." };
  }
  return { ok: true, pin: pin && pin.pk ? null : rec.pk, reason: "firma valida" };
}

/// Controllo prima di cifrare per `peer`. Se il server non ha la funzione (vecchio), passa.
/// Lancia un Error con messaggio leggibile se va bloccato. Ritorna le chiavi firmate: chi cifra
/// deve usare ESATTAMENTE quelle (vedi send.js), non quelle di una seconda richiesta.
export async function assertPeerKeys(peer) {
  let all = null;
  try { all = await api.pulseKeySigs([peer]); } catch { return { signed: false }; } // server senza la funzione
  const rec = all && all[String(peer).toLowerCase()];
  const pin = await getPin(peer);
  const d = decide(String(peer).toLowerCase(), rec, pin);
  if (!d.ok) throw new Error(d.reason);
  if (d.pin) await setPin(peer, d.pin);
  const signed = !!(rec && rec.sig && rec.pk);
  return { signed, kem: signed ? String(rec.kem).toLowerCase() : "", dh: signed ? String(rec.dh).toLowerCase() : "" };
}
