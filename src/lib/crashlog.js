// Diagnostica degli arresti: se l'app muore per un errore nativo (fuori dalla portata del
// JavaScript), il dettaglio viene scritto su file da MainActivity e mostrato qui al riavvio.
// Serve a non trovarsi mai più con "l'app si è chiusa" e nessuna traccia.
import { Alert, Share } from "react-native";
import * as FileSystem from "expo-file-system/legacy";

const NATIVE = FileSystem.documentDirectory + "nativecrash.txt";
const JS = FileSystem.documentDirectory + "lastcrash.txt";

async function readAndClear(path) {
  try {
    const txt = await FileSystem.readAsStringAsync(path);
    await FileSystem.deleteAsync(path, { idempotent: true });
    return txt && txt.trim() ? txt : "";
  } catch { return ""; }
}

/// Toglie dal testo cio' che non deve uscire dal telefono: indirizzi Lattice, indirizzi IP,
/// sequenze esadecimali lunghe (chiavi, hash, token) e percorsi dell'utente.
export function scrub(t) {
  return String(t || "")
    .replace(/[A-Za-z0-9._-]+@[A-Za-z0-9.-]+/g, "<indirizzo>")
    .replace(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g, "<ip>")
    .replace(/\b[0-9a-fA-F]{24,}\b/g, "<hex>")
    .replace(/(file:\/\/)?\/(?:data|storage|sdcard)\/[^\s:)]+/g, "<percorso>");
}

export async function reportPendingCrash(isEnglish) {
  // Entrambi i file vengono sempre letti E cancellati: nessun residuo che ricompare.
  const nat = await readAndClear(NATIVE);
  const js = await readAndClear(JS);
  const txt = scrub(nat || js);
  if (!txt) return false;
  const en = !!isEnglish;
  Alert.alert(
    en ? "Last time the app stopped" : "L'ultima volta l'app si è fermata",
    (en ? "Here is what went wrong. Send it to the developer: it is all that is needed to fix it.\n\n"
        : "Ecco cosa è andato storto. Mandalo allo sviluppatore: è tutto quello che serve per sistemarlo.\n\n") +
      txt.slice(0, 700),
    [
      { text: en ? "Share" : "Condividi", onPress: () => Share.share({ message: "ULTRON crash:\n" + txt.slice(0, 3000) }).catch(() => {}) },
      { text: "OK", style: "cancel" },
    ]
  );
  return true;
}
