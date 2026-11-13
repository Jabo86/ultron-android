// ULTRON: sveglia tramite connessione diretta al proprio nodo.
// Scrive la configurazione in files/wake.json: il servizio nativo (WakeService.kt) la legge
// e tiene aperta una connessione in attesa verso il nostro server. Il gettone (rid) è
// casuale e non contiene la tua identità; il servizio non ha bisogno della chiave privata.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { NativeModules } from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import { randomHex } from "./crypto";
import * as api from "./api";

const FILE = FileSystem.documentDirectory + "wake.json";
const RID_KEY = "lat.wake.rid";
const ON_KEY = "lat.wake.on";
let operation = Promise.resolve();

function serialize(task) {
  const next = operation.then(task);
  operation = next.catch(() => {});
  return next;
}

export async function isOn() {
  return (await AsyncStorage.getItem(ON_KEY)) === "1";
}

async function writeConfig(on, rid) {
  const base = api.getServerUrl().replace(/\/+$/, "");
  if (on && !base.startsWith("https://")) throw new Error("ULTRON richiede HTTPS per le notifiche.");
  // Il rumore in background (letto dal WakeService nativo) è acceso di default.
  const chaff = (await AsyncStorage.getItem("lat.chaff.v1")) !== "0";
  await FileSystem.writeAsStringAsync(FILE, JSON.stringify({ on: !!on, rid: rid || "", base, chaff }));
}

/// Riscrive il file di config quando l'utente cambia l'interruttore del rumore, così il
/// servizio nativo vede subito il nuovo stato (mantiene lo stato della sveglia).
async function writeChaff() {
  const on = (await AsyncStorage.getItem(ON_KEY)) === "1";
  const rid = (await AsyncStorage.getItem(RID_KEY)) || "";
  await writeConfig(on, rid);
}

async function register() {
  if (!api.getServerUrl().startsWith("https://")) throw new Error("ULTRON richiede HTTPS per le notifiche.");
  if (!NativeModules.WakeControl?.start) throw new Error("Servizio notifiche ULTRON non disponibile.");
  let rid = await AsyncStorage.getItem(RID_KEY);
  if (!rid || rid.length < 32) {
    rid = randomHex(24); // 48 caratteri esadecimali
    await AsyncStorage.setItem(RID_KEY, rid);
  }
  await api.wakeRegister(rid);
  await writeConfig(true, rid);
  try {
    if (!(await NativeModules.WakeControl.start())) throw new Error("Android non ha avviato il servizio ULTRON.");
    await AsyncStorage.setItem(ON_KEY, "1");
  } catch (error) {
    await writeConfig(false, rid);
    throw error;
  }
  return rid;
}

async function revoke() {
  const rid = await AsyncStorage.getItem(RID_KEY);
  await AsyncStorage.setItem(ON_KEY, "0");
  await writeConfig(false, rid);
  if (rid) {
    await AsyncStorage.removeItem(RID_KEY);
    try { await api.wakeRevoke(rid); } catch { /* il gettone scade da solo */ }
  }
}

/// All'avvio dell'app: se la sveglia è attiva riallinea server e file di configurazione
/// (per esempio dopo un cambio di server o un ripristino da backup).
async function renew() {
  const preference = await AsyncStorage.getItem(ON_KEY);
  if (preference === "0") return false;
  if (preference === null) {
    const { requestNotificationPermission } = require("./notifications");
    if (!(await requestNotificationPermission({ askPermission: false }))) return false;
    await register();
    return true;
  }
  const rid = await AsyncStorage.getItem(RID_KEY);
  if (!rid) { await register(); return true; }
  await api.wakeRegister(rid);
  await writeConfig(true, rid);
  if (NativeModules.WakeControl?.start) await NativeModules.WakeControl.start();
  return true;
}

export const applyChaff = () => serialize(writeChaff);
export const enable = () => serialize(register);
export const disable = () => serialize(revoke);
export const refresh = () => serialize(renew);
