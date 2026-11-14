// AVVISO PRIMA DI TRADURRE.
// La traduzione NON e' end-to-end: il testo del messaggio, gia' decifrato sul telefono,
// parte in chiaro verso il server (`/public/translate`) che lo traduce. E' una breccia
// consapevole nella cifratura, quindi non deve mai succedere senza che l'utente lo sappia.
// Il consenso si da' una volta e si puo' ritirare dalle impostazioni; la traduzione
// AUTOMATICA non parte mai senza consenso gia' dato (e non mostra finestre a raffica).
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Alert } from "react-native";

const KEY = "lat.tr.consent.v1";

export async function hasConsent() {
  try { return (await AsyncStorage.getItem(KEY)) === "1"; } catch { return false; }
}
export async function revokeConsent() {
  try { await AsyncStorage.removeItem(KEY); } catch { /* niente */ }
}

/// true se si puo' tradurre. Se manca il consenso lo chiede (una volta sola).
export function ask(lang) {
  return new Promise(async (resolve) => {
    if (await hasConsent()) { resolve(true); return; }
    const en = lang === "en";
    Alert.alert(
      en ? "Translating leaves end-to-end encryption" : "Tradurre esce dalla cifratura end-to-end",
      en
        ? "To translate, the text of the message is sent in clear to your server's translation service. It is not stored by the app, but the server sees it. Translate anyway?"
        : "Per tradurre, il testo del messaggio viene inviato in chiaro al servizio di traduzione del tuo server. L'app non lo conserva, ma il server lo vede. Vuoi tradurre lo stesso?",
      [
        { text: en ? "Cancel" : "Annulla", style: "cancel", onPress: () => resolve(false) },
        { text: en ? "Translate" : "Traduci", onPress: async () => { try { await AsyncStorage.setItem(KEY, "1"); } catch { /* niente */ } resolve(true); } },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}
