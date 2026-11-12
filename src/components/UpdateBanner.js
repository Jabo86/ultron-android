import React, { useEffect, useState } from "react";
import * as FileSystem from "expo-file-system/legacy";
import { AppState, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { theme } from "../theme";
import { suppressLock } from "../lib/lockGuard";
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
        !(await FileSystem.getInfoAsync(prepared.file)).exists) {
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
    setFailed(false);
    try {
      const update = await checkAndPrepare();
      if (update) {
        suppressLock();
        await installUpdate(update.file);
      } else {
        setRelease(null);
      }
    }
    catch { setFailed(true); }
    finally { setInstalling(false); }
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
  </View>;
}

const styles = StyleSheet.create({
  wrap: { backgroundColor: theme.surface, paddingHorizontal: 16, paddingBottom: 8, flexDirection: "row", alignItems: "center", gap: 12 },
  text: { color: theme.text, flex: 1 },
  button: { color: theme.primary, fontWeight: "700", padding: 8 },
});
