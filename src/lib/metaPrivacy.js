// METADATI VISIBILI AL SERVER: «sta scrivendo», presenza online, conferma di lettura.
// Il contenuto dei messaggi e' gia' cifrato; questi tre segnali no: il server vede chi e'
// in linea, chi sta scrivendo e quando legge. Qui si possono spegnere uno per uno.
// Di default restano accesi (comodita'); in «Privacy e blocco» si spengono.
import AsyncStorage from "@react-native-async-storage/async-storage";

const KEYS = { typing: "lat.mp.typing", presence: "lat.mp.presence", read: "lat.mp.read" };
const hidden = { typing: false, presence: false, read: false };
let loaded = null;

export function load() {
  if (!loaded) {
    loaded = Promise.all(Object.keys(KEYS).map(async (k) => {
      try { hidden[k] = (await AsyncStorage.getItem(KEYS[k])) === "1"; } catch { /* resta acceso */ }
    })).then(() => ({ ...hidden }));
  }
  return loaded;
}
load();

/// true = quel segnale NON va mandato al server.
export const isHidden = (k) => !!hidden[k];

export async function setHidden(k, v) {
  if (!KEYS[k]) return;
  hidden[k] = !!v;
  await AsyncStorage.setItem(KEYS[k], v ? "1" : "0");
}
export const all = () => ({ ...hidden });
