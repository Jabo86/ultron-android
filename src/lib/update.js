// Aggiornamento in-app: legge il manifest del rilascio GitHub e controlla che
// sia firmato dal produttore (ML-DSA-65), scarica l'APK e ne verifica l'impronta SHA-256
// prima di passarlo all'installer. Se il server viene bucato e l'APK sostituito, la firma o
// l'impronta non tornano e l'installazione NON parte. Rifiutati anche i "downgrade".
import * as FileSystem from "expo-file-system/legacy";
import * as IntentLauncher from "expo-intent-launcher";
import { NativeModules, Platform } from "react-native";
import { VENDOR_PUB } from "./vendorKey";
import { verifyManifest, fileSha256 } from "./apkVerify";

const releaseBase = "https://github.com/Jabo86/ultron-android/releases";
const currentCode = Number(process.env.EXPO_PUBLIC_ULTRON_VERSION_CODE);
export const updatesConfigured = Platform.OS === "android" && !!VENDOR_PUB && Number.isSafeInteger(currentCode) && currentCode > 0;

function authentic(m) {
  return Number.isSafeInteger(m?.versionCode) && Number.isSafeInteger(m.size)
    && m.size > 0 && /^[0-9a-f]{64}$/.test(m.sha256)
    && /^\d+\.\d+\.\d+$/.test(m.versionName)
    && m.url === `${releaseBase}/download/android-${m.versionCode}/ULTRON-Messaggi.apk`
    && verifyManifest(m);
}

export async function checkUpdate() {
  if (!updatesConfigured) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  let manifest;
  try {
    const response = await fetch(releaseBase + "/latest/download/latest.json", {
      cache: "no-store", signal: controller.signal,
    });
    if (response.status === 404) throw new Error("ULTRON_RELEASE_UNAVAILABLE");
    if (!response.ok) throw new Error("HTTP " + response.status);
    manifest = await response.json();
  } finally {
    clearTimeout(timer);
  }
  if (!authentic(manifest)) throw new Error("Manifest ULTRON non valido.");
  return manifest.versionCode > currentCode ? manifest : null;
}

export async function prepareUpdate(m, onProgress) {
  if (!updatesConfigured || !authentic(m) || m.versionCode <= currentCode) {
    throw new Error("Aggiornamento ULTRON rifiutato.");
  }
  const url = m.url;
  const dest = FileSystem.cacheDirectory + "ultron-update-" + m.versionCode + ".apk";
  try { await FileSystem.deleteAsync(dest, { idempotent: true }); } catch { /* nuovo file */ }
  const task = FileSystem.createDownloadResumable(url, dest, {}, (p) => {
    if (onProgress && p.totalBytesExpectedToWrite > 0) {
      onProgress(p.totalBytesWritten / p.totalBytesExpectedToWrite, "download");
    }
  });
  const res = await task.downloadAsync();
  if (!res || res.status !== 200 || !res.uri) throw new Error("Download non completato");

  const info2 = await FileSystem.getInfoAsync(res.uri, { size: true });
  const size = (info2 && info2.size) || 0;
  if (!info2.exists || size < 5 * 1024 * 1024) throw new Error("Download incompleto: riprova");
  if (m.size && size !== m.size) {
    try { await FileSystem.deleteAsync(res.uri, { idempotent: true }); } catch { /* */ }
    throw new Error("Il file scaricato non corrisponde al manifest firmato: installazione annullata.");
  }

  const sha = await fileSha256(res.uri, size, (p) => { if (onProgress) onProgress(p, "verify"); });
  if (String(m.sha256 || "").toLowerCase() !== sha.toLowerCase()) {
    try { await FileSystem.deleteAsync(res.uri, { idempotent: true }); } catch { /* */ }
    throw new Error("Impronta dell'APK diversa da quella firmata: file rifiutato e cancellato.");
  }

  return res.uri;
}

export async function installUpdate(uri) {
  const canInstall = NativeModules.LatticeDeviceInfo?.canInstallUpdates;
  if (canInstall && !(await canInstall())) {
    await IntentLauncher.startActivityAsync("android.settings.MANAGE_UNKNOWN_APP_SOURCES", {
      data: "package:com.ultron.messenger",
    });
    if (!(await canInstall())) throw new Error("ULTRON_INSTALL_PERMISSION");
  }
  const contentUri = await FileSystem.getContentUriAsync(uri);
  const opts = { data: contentUri, flags: 1, type: "application/vnd.android.package-archive" };
  try {
    await IntentLauncher.startActivityAsync("android.intent.action.INSTALL_PACKAGE", opts);
  } catch {
    // ACTION_INSTALL_PACKAGE è deprecata da API 29: proviamo VIEW.
    await IntentLauncher.startActivityAsync("android.intent.action.VIEW", opts);
  }
}
