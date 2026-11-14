// AUTENTICAZIONE DEL MITTENTE — interruttori e chiavi dei contatti.
//
// Senza questa parte, un messaggio "da Mario" e' solo un messaggio che il SERVER dice
// essere di Mario: cifrare verso una chiave pubblica non richiede nessun segreto. Con
// l'autenticazione, la chiave di ogni busta dipende anche da DH(identita' di Mario,
// identita' tua): senza il segreto di Mario non si puo' fabbricare un messaggio che tu
// accetti come suo. Il server non puo' piu' inserire messaggi a nome di un contatto.
//
// Due interruttori, entrambi SPENTI finche' non sono aggiornati tutti i telefoni
// (le app vecchie non capiscono le buste autenticate):
//   · INVIO   = i miei messaggi partono autenticati;
//   · RIGORE  = rifiuto i messaggi in arrivo che non sono autenticati (blocca il downgrade).
// Ordine giusto: aggiorna tutti, accendi INVIO ovunque, poi accendi RIGORE ovunque.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getBlob, setBlob } from "./lock";
import * as api from "./api";

const K_SEND = "lat.auth.send";
const K_STRICT = "lat.auth.strict";
const DHK_BLOB = "dhpk"; // stessa cassaforte di ratchet.js: chiavi X25519 d'identita' dei contatti

export async function sendOn() { try { return (await AsyncStorage.getItem(K_SEND)) === "1"; } catch { return false; } }
export async function strictOn() { try { return (await AsyncStorage.getItem(K_STRICT)) === "1"; } catch { return false; } }
export async function setSend(v) { try { await AsyncStorage.setItem(K_SEND, v ? "1" : "0"); } catch { /* niente */ } }
export async function setStrict(v) { try { await AsyncStorage.setItem(K_STRICT, v ? "1" : "0"); } catch { /* niente */ } }

/// Chiave X25519 d'identita' di un contatto COME LA CONOSCIAMO NOI. Prima la cassaforte
/// locale (la prima chiave vista resta quella: se il server ne mostra un'altra, non la si
/// accetta in silenzio); solo se manca la si chiede al server e la si registra.
export async function pinnedDhPk(peer, myLns, myDhPkHex) {
  const p = String(peer || "").toLowerCase();
  if (!p) return "";
  if (myLns && p === String(myLns).toLowerCase() && myDhPkHex) return myDhPkHex;
  const cache = (await getBlob(DHK_BLOB)) || {};
  if (typeof cache[p] === "string" && cache[p].length === 64) return cache[p];
  let pk = "";
  try { pk = ((await api.pulseDhKeys([p])) || {})[p] || ""; } catch { /* niente rete */ }
  if (typeof pk === "string" && pk.length === 64) {
    cache[p] = pk;
    await setBlob(DHK_BLOB, cache);
    return pk;
  }
  return "";
}
