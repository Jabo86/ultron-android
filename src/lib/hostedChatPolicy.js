import AsyncStorage from "@react-native-async-storage/async-storage";
import { sha256Hex } from "./crypto";

function modeKey(user, peer) {
  return "ultron.ratchet-required:" + sha256Hex(JSON.stringify([user.server, user.lns, peer]));
}

// Only call after an authenticated ratchet exchange succeeds. Network failures,
// device-list changes and exhaustion must never remove this requirement.
export async function requireHostedRatchet(user, peer) {
  await AsyncStorage.setItem(modeKey(user, peer), "1");
}

export async function assertHostedLegacyAllowed(user, peer) {
  if (await AsyncStorage.getItem(modeKey(user, peer)) !== null) {
    throw new Error("Questa chat richiede il ratchet. Invio sospeso finché la sessione protetta non è disponibile.");
  }
}
