import React, { useEffect, useState } from "react";
import { AppState, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { theme } from "../theme";
import { useI18n } from "../lib/i18n";
import { checkUpdate, installUpdate, prepareUpdate, updatesConfigured } from "../lib/update";

let pending;
let prepared;
let lastCheck = 0;

function checkAndPrepare() {
  if (pending) return pending;
  if (Date.now() - lastCheck < 15 * 60_000) return Promise.resolve(prepared);
  lastCheck = Date.now();
  pending = (async () => {
    const manifest = await checkUpdate();
    if (!manifest) { prepared = null; return null; }
    if (prepared?.versionCode !== manifest.versionCode) {
      prepared = { ...manifest, file: await prepareUpdate(manifest) };
    }
    return prepared;
  })().catch(() => {
    lastCheck = Date.now() - 14 * 60_000;
    return prepared;
  }).finally(() => { pending = null; });
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
      if (AppState.currentState === "active") {
        checkAndPrepare().then((result) => { if (alive) setRelease(result); });
      }
    };
    refresh();
    const sub = AppState.addEventListener("change", refresh);
    const timer = setInterval(refresh, 15 * 60_000);
    return () => { alive = false; sub.remove(); clearInterval(timer); };
  }, []);

  const install = async () => {
    setInstalling(true);
    setFailed(false);
    try { await installUpdate(release.file); }
    catch { setFailed(true); }
    finally { setInstalling(false); }
  };

  if (!release) return null;
  return <View style={[styles.wrap, { paddingTop: top + 8 }]}>
    <Text style={styles.text}>
      {failed
        ? (english ? "Could not open Android installer." : "Impossibile aprire il programma di installazione Android.")
        : (english ? "Verified update ready" : "Aggiornamento verificato pronto") + " · " + release.versionName}
    </Text>
    <Pressable accessibilityRole="button" onPress={install} disabled={installing}>
      <Text style={styles.button}>{english ? "Install" : "Installa"}</Text>
    </Pressable>
  </View>;
}

const styles = StyleSheet.create({
  wrap: { backgroundColor: theme.surface, paddingHorizontal: 16, paddingBottom: 8, flexDirection: "row", alignItems: "center", gap: 12 },
  text: { color: theme.text, flex: 1 },
  button: { color: theme.primary, fontWeight: "700", padding: 8 },
});
