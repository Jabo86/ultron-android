// BACKUP CIFRATO LOCALE — il file non passa MAI dal server: viene creato sul telefono,
// cifrato con AES-256-GCM (chiave da scrypt) e consegnato al sistema (Condividi/Salva) così
// lo metti dove vuoi tu. Nessun upload, nessuna copia in cloud fatta dall'app.
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import * as DocumentPicker from "expo-document-picker";
import { Platform } from "react-native";
import notifee, { AndroidImportance, TimeUnit, TriggerType } from "react-native-notify-kit";
import { FMT, encryptContainer, decryptContainer, passphraseProblem, enc8, dec8 } from "./backupCrypto";
export { FMT, encryptContainer, decryptContainer, passphraseProblem };
import {
  bytesToHex, hexToBytes, randomHex, bytesToBase64, base64ToBytes,
  unpackMessage, decryptFileBytes,
} from "./crypto";
import * as api from "./api";
import * as store from "./store";
import { getBlob, setBlob } from "./lock";
import { decryptAny } from "./devices";
import * as mbx from "./mailbox";

const ARC_BLOB = "arc";
const K_LAST = "lat.bkp.last";
const K_EVERY = "lat.bkp.every"; // "off" | "weekly" | "monthly"
const MAX_FILE = 8 * 1024 * 1024;
const MAX_TOTAL = 120 * 1024 * 1024;
const RESTORED_DIR = "lattice-ripristinati/";

// ── Contenuto del backup ──
export async function buildPayload({ user, includeAtts = false, onStep } = {}) {
  const step = (s) => { try { onStep && onStep(s); } catch { /* */ } };
  const counts = { convs: 0, msgs: 0, files: 0, prefs: 0, bytes: 0, skippedEphemeral: 0 };

  step("Chiavi e impostazioni");
  const keyfile = await store.loadKeyfile();
  const prefs = {};
  try {
    const keys = await AsyncStorage.getAllKeys();
    const wanted = keys.filter((k) => !k.startsWith("lat.enc.") && k !== "lattice.pulse.keyfile.v1");
    const pairs = await AsyncStorage.multiGet(wanted);
    for (const [k, v] of pairs) if (v != null) prefs[k] = v;
    counts.prefs = Object.keys(prefs).length;
  } catch { /* */ }
  const mbxHistory = await getBlob("mbx");
  const archivePrev = (await getBlob(ARC_BLOB)) || {};

  let contacts = [];
  const convs = [];
  const files = [];
  if (user && user.lns) {
    step("Rubrica");
    try { contacts = await api.contacts(); } catch { /* */ }
    step("Conversazioni");
    let list = [];
    try { list = await api.convs(); } catch { /* */ }
    for (const c of Array.isArray(list) ? list : []) {
      step("Conversazione: " + (c.title || c.title_lns || c.conv_id));
      let raw = [];
      try { raw = await api.messages(c.conv_id); } catch { continue; }
      const msgs = [];
      for (const m of Array.isArray(raw) ? raw : []) {
        let body = "";
        let atts = [];
        if (m.envelope && user.kem) {
          const pt = await decryptAny(m, user);
          if (pt == null) continue;
          const u = unpackMessage(pt);
          // Messaggi a scomparsa: NON entrano nel backup. Se devono svanire, svaniscono
          // anche qui: un backup non può diventare la scappatoia dell'autodistruzione.
          if ((u.ttl || 0) > 0) { counts.skippedEphemeral++; continue; }
          body = u.text || "";
          atts = u.atts || [];
        }
        if (typeof body === "string" && body.startsWith(mbx.CTL_PREFIX)) continue;
        const names = [];
        for (const a of atts) {
          names.push({ name: a.name || "allegato", mime: a.mime || "" });
          if (!includeAtts) continue;
          if (counts.bytes > MAX_TOTAL) continue;
          try {
            const ct = await api.blobDownload(a.id);
            if (ct.length > MAX_FILE) continue;
            const bytes = decryptFileBytes(ct, a.key, a.iv);
            files.push({ id: a.id, name: a.name || a.id, mime: a.mime || "application/octet-stream", b64: bytesToBase64(bytes) });
            counts.files++;
            counts.bytes += bytes.length;
          } catch { /* allegato non più sul server */ }
        }
        msgs.push({ id: m.message_id, mine: !!m.mine, body, atts: names, at: m.sent_at || m.created_at });
        counts.msgs++;
      }
      // I messaggi anonimi (cassetta) e quelli già archiviati vivono solo sul telefono:
      // vanno nel backup, altrimenti si perdono per sempre.
      try {
        const anon = await mbx.localForConv(c.conv_id);
        for (const a of anon) { msgs.push({ id: a.id, mine: a.mine, body: a.body, atts: [], at: a.at, anon: true }); counts.msgs++; }
      } catch { /* */ }
      const prev = archivePrev[c.conv_id] || [];
      const have = new Set(msgs.map((m) => m.id));
      for (const p of prev) if (!have.has(p.id)) { msgs.push(p); counts.msgs++; }
      msgs.sort((a, b) => String(a.at || "").localeCompare(String(b.at || "")));
      convs.push({ conv_id: c.conv_id, title: c.title || c.title_lns || "", title_lns: c.title_lns || "", msgs });
      counts.convs++;
    }
  }

  return {
    payload: {
      v: 1, at: new Date().toISOString(), lns: (user && user.lns) || (keyfile && keyfile.lns) || "",
      keyfile: keyfile || null, prefs, mbx: mbxHistory || null, contacts, convs, files,
    },
    counts,
  };
}

function fileName(lns, at) {
  const d = String(at || new Date().toISOString()).slice(0, 16).replace(/[:T]/g, "-");
  const who = String(lns || "lattice").split("@")[0].replace(/[^a-zA-Z0-9._-]/g, "");
  return `lattice-backup-${who}-${d}.lattice`;
}

export async function exportBackup({ user, includeAtts, password, hint, onStep } = {}) {
  const weak = passphraseProblem(password);
  if (weak) throw new Error(weak);
  const { payload, counts } = await buildPayload({ user, includeAtts, onStep });
  onStep && onStep("Cifratura del file");
  const container = encryptContainer(payload, String(password), hint);
  const name = fileName(payload.lns, payload.at);
  const uri = FileSystem.documentDirectory + name;
  await FileSystem.writeAsStringAsync(uri, JSON.stringify(container));
  const info = await FileSystem.getInfoAsync(uri);
  await AsyncStorage.setItem(K_LAST, payload.at);
  onStep && onStep("Pronto: scegli dove salvarlo");
  try {
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(uri, { mimeType: "application/octet-stream", dialogTitle: "Salva il backup cifrato" });
    }
  } catch { /* l'utente può recuperarlo dalla cartella dell'app */ }
  return { uri, name, size: (info && info.size) || 0, counts };
}

export async function pickBackupFile() {
  const r = await DocumentPicker.getDocumentAsync({ type: "*/*", copyToCacheDirectory: true, multiple: false });
  if (r.canceled) return null;
  const asset = r.assets && r.assets[0];
  if (!asset) return null;
  const txt = await FileSystem.readAsStringAsync(asset.uri);
  let container;
  try { container = JSON.parse(txt); } catch { throw new Error("File illeggibile: non è un backup ULTRON."); }
  if (container.fmt !== FMT) throw new Error("Questo file non è un backup ULTRON.");
  return { container, name: asset.name || "backup" };
}

// ── Ripristino ──
export async function restorePayload(payload) {
  const report = { prefs: 0, convs: 0, msgs: 0, files: 0, keyfile: false, mbx: false };
  if (!payload || payload.v !== 1) throw new Error("Versione del backup non supportata.");
  if (payload.prefs) {
    const pairs = Object.entries(payload.prefs).filter(([k]) => k !== K_LAST);
    if (pairs.length) { try { await AsyncStorage.multiSet(pairs); report.prefs = pairs.length; } catch { /* */ } }
  }
  if (payload.mbx) { try { await setBlob("mbx", payload.mbx); report.mbx = true; } catch { /* */ } }
  if (Array.isArray(payload.convs) && payload.convs.length) {
    const arc = (await getBlob(ARC_BLOB)) || {};
    for (const c of payload.convs) {
      const prev = arc[c.conv_id] || [];
      const have = new Set(prev.map((m) => m.id));
      const merged = prev.concat((c.msgs || []).filter((m) => !have.has(m.id)));
      merged.sort((a, b) => String(a.at || "").localeCompare(String(b.at || "")));
      arc[c.conv_id] = merged;
      report.convs++;
      report.msgs += (c.msgs || []).length;
    }
    await setBlob(ARC_BLOB, arc);
  }
  if (Array.isArray(payload.files) && payload.files.length) {
    const dir = FileSystem.documentDirectory + RESTORED_DIR;
    try { await FileSystem.makeDirectoryAsync(dir, { intermediates: true }); } catch { /* già presente */ }
    for (const f of payload.files) {
      try {
        await FileSystem.writeAsStringAsync(dir + safeName(f.name || f.id), f.b64, { encoding: FileSystem.EncodingType.Base64 });
        report.files++;
      } catch { /* */ }
    }
  }
  if (payload.keyfile) { await store.saveKeyfile(payload.keyfile); report.keyfile = true; }
  return report;
}

function safeName(n) {
  return String(n).replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
}

export async function restoredFiles() {
  try {
    const dir = FileSystem.documentDirectory + RESTORED_DIR;
    const names = await FileSystem.readDirectoryAsync(dir);
    return names.map((n) => ({ name: n, uri: dir + n }));
  } catch { return []; }
}

export async function shareRestoredFile(uri) {
  if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri);
}

/// Messaggi dell'archivio (ripristinati da un backup) per una conversazione.
export async function archiveForConv(cid) {
  const arc = await getBlob(ARC_BLOB);
  const list = (arc && arc[cid]) || [];
  return list.map((m) => ({
    id: m.id, mine: !!m.mine,
    body: (m.body || "") + ((m.atts || []).length ? "\n📎 " + m.atts.map((a) => a.name).join(", ") : ""),
    atts: [], reply: null, signed: null, reactions: [], ttl: 0, at: m.at,
    delivered: true, read: true, edited: false, pinned: false, archived: true,
  }));
}

export async function clearArchive() {
  await setBlob(ARC_BLOB, {});
}

// ── Promemoria (solo locale: il server non sa nulla dei tuoi backup) ──
export async function lastBackupAt() {
  return await AsyncStorage.getItem(K_LAST);
}
export async function getSchedule() {
  return (await AsyncStorage.getItem(K_EVERY)) || "off";
}
export async function setSchedule(mode) {
  await AsyncStorage.setItem(K_EVERY, mode);
  if (Platform.OS !== "android") return true;
  const id = "backup-reminder";
  try {
    await notifee.cancelTriggerNotification(id);
    if (mode === "off") return true;
    const channelId = await notifee.createChannel({
      id: "backup-reminders",
      name: "Promemoria backup",
      importance: AndroidImportance.HIGH,
    });
    await notifee.createTriggerNotification({
      id,
      title: "Backup ULTRON",
      body: "Promemoria: crea un backup cifrato aggiornato delle tue chat.",
      android: { channelId },
    }, {
      type: TriggerType.INTERVAL,
      interval: mode === "monthly" ? 30 : 7,
      timeUnit: TimeUnit.DAYS,
    });
  } catch { /* notifiche non disponibili */ }
  return true;
}
