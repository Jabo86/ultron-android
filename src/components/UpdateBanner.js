import React, { useEffect, useState } from "react";
import * as FileSystem from "expo-file-system/legacy";
import { AppState, Image, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { theme } from "../theme";
import { useI18n } from "../lib/i18n";
import { checkUpdate, installUpdate, prepareUpdate, updatesConfigured } from "../lib/update";

let pending;
let prepared;
let lastCheck = 0;

export function checkAndPrepare(onProgress) {
  if (pending) return pending;
  pending = (async () => {
    const manifest = await checkUpdate();
    if (!manifest) { prepared = null; return null; }
    if (prepared?.versionCode !== manifest.versionCode ||
        prepared.sha256 !== manifest.sha256 || !(await FileSystem.getInfoAsync(prepared.file)).exists) {
      prepared = { ...manifest, file: await prepareUpdate(manifest, onProgress) };
    }
    return prepared;
  })().finally(() => { pending = null; });
  return pending;
}

export function UpdateBanner() {
  const { top } = useSafeAreaInsets();
  const { lang } = useI18n();
  const english = lang === "en";
  const [release, setRelease] = useState(null);
  const [installing, setInstalling] = useState(false);
  const [failed, setFailed] = useState(false);
  const [progress, setProgress] = useState(null);

  useEffect(() => {
    if (!updatesConfigured) return;
    let alive = true;
    const refresh = () => {
      if (AppState.currentState !== "active" || Date.now() - lastCheck < 15 * 60_000) return;
      lastCheck = Date.now();
      checkUpdate().then((result) => { if (alive) setRelease(result); }).catch(() => {});
    };
    refresh();
    const sub = AppState.addEventListener("change", refresh);
    const timer = setInterval(refresh, 15 * 60_000);
    return () => { alive = false; sub.remove(); clearInterval(timer); };
  }, []);

  const install = async () => {
    setInstalling(true);
    setProgress({ value: 0, phase: "download" });
    setFailed(false);
    try {
      const update = await checkAndPrepare((value, phase) => setProgress({ value, phase }));
      if (update) {
        setProgress({ value: 1, phase: "ready" });
        await installUpdate(update.file);
      } else {
        setRelease(null);
      }
    }
    catch { setFailed(true); }
    finally { setInstalling(false); setProgress(null); }
  };

  if (!release) return null;
  return <View style={[styles.wrap, { paddingTop: top + 8 }]}>
    <Text style={styles.text}>
      {failed
        ? (english ? "Update failed. Try again from Settings." : "Aggiornamento non riuscito. Riprova dalle impostazioni.")
        : (english ? "Signed update available" : "Aggiornamento firmato disponibile") + " · " + release.versionName}
    </Text>
    <Pressable accessibilityRole="button" onPress={install} disabled={installing}>
      <Text style={styles.button}>{installing ? (english ? "Preparing…" : "Preparazione…") : (english ? "Install" : "Installa")}</Text>
    </Pressable>
    <UpdateProgress progress={progress} english={english} />
  </View>;
}

export function UpdateProgress({ progress, english }) {
  if (!progress) return null;
  const { value, phase } = progress;
  const ratio = Math.max(0, Math.min(1, value));
  const percent = phase === "ready" ? 100
    : phase === "verify" ? 90 + Math.floor(ratio * 9) : Math.floor(ratio * 90);
  const label = phase === "ready" ? (english ? "Confirm in Android" : "Conferma in Android")
    : phase === "verify" ? (english ? "Verifying signature and APK" : "Verifica di firma e APK")
      : (english ? "Downloading update" : "Scaricamento aggiornamento");
  return <Modal visible transparent animationType="fade" onRequestClose={() => {}}>
    <View style={styles.overlay}>
      <View style={styles.progressCard}>
        <Image source={require("../../assets/ultron-logo.png")} resizeMode="contain" style={styles.logo} />
        <Text style={styles.progressText}>{label}</Text>
        <View style={styles.track} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: percent }}>
          <View style={[styles.fill, { width: percent + "%" }]} />
        </View>
        <Text style={styles.progressText}>{percent}%</Text>
      </View>
    </View>
  </Modal>;
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#000B" },
  progressCard: { width: "80%", maxWidth: 420, alignItems: "center", gap: 14, padding: 24, borderRadius: 18, backgroundColor: theme.surface },
  progressText: { color: theme.text, textAlign: "center" },
  logo: { width: 96, height: 96 },
  track: { width: "100%", height: 8, borderRadius: 4, overflow: "hidden", backgroundColor: theme.border },
  fill: { height: "100%", backgroundColor: theme.primary },
  wrap: { backgroundColor: theme.surface, paddingHorizontal: 16, paddingBottom: 8, flexDirection: "row", alignItems: "center", gap: 12 },
  text: { color: theme.text, flex: 1 },
  button: { color: theme.primary, fontWeight: "700", padding: 8 },
});
