import React, { useEffect, useState } from "react";
import { Alert, Linking, Pressable, ScrollView, StyleSheet, Switch, Text, TouchableOpacity, Vibration, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { createAudioPlayer } from "expo-audio";
import { saveRingtone, loadRingtone, saveRingVolume, loadRingVolume, saveVibMode, loadVibMode } from "../lib/store";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useI18n } from "../lib/i18n";
import { requestNotificationPermission } from "../lib/notifications";
import { testNotify } from "../lib/api";
import * as wake from "../lib/wake";
import { theme } from "../theme";

const RINGTONES = { classic: require("../../assets/ringtone.wav"), chime: require("../../assets/ring_chime.wav"), beep: require("../../assets/ring_beep.wav"), digital: require("../../assets/ring_digital.wav"), marimba: require("../../assets/ring_marimba.wav"), pulse: require("../../assets/ring_pulse.wav") };
const RINGTONE_OPTS = [["system", "Suoneria del telefono"], ["classic", "Classica"], ["chime", "Chime"], ["beep", "Beep"], ["digital", "Digitale"], ["marimba", "Marimba"], ["pulse", "Pulsazione"]];
const VIB_PATTERNS = { standard: [0, 700, 900, 700], short: [0, 400, 300, 400], long: [0, 1200, 600, 1200] };

export default function NotificationsScreen({ navigation }) {
  const { top } = useSafeAreaInsets();
  const { lang } = useI18n();
  const en = lang === "en";
  const label = (it, english) => en ? english : it;
  const [ringtone, setRingtone] = useState("classic");
  const [ringVol, setRingVol] = useState(1);
  const [vibMode, setVibMode] = useState("standard");
  const [enabled, setEnabled] = useState(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  useEffect(() => { wake.isOn().then(setEnabled).catch(() => {}); }, []);

  useEffect(() => {
    (async () => {
      try { setRingtone(await loadRingtone()); } catch (e) {}
      try { setRingVol(await loadRingVolume()); } catch (e) {}
      try { setVibMode(await loadVibMode()); } catch (e) {}
    })();
  }, []);

  const previewRing = (key, vol) => {
    if (key === "system") return; // usa la suoneria di sistema del telefono
    try {
      const pl = createAudioPlayer(RINGTONES[key] || RINGTONES.classic);
      try { pl.volume = vol; } catch (e2) {}
      pl.play();
      setTimeout(() => { try { pl.remove(); } catch (e) {} }, 2600);
    } catch (e) {}
  };

  const change = async (value) => {
    setBusy(true);
    setStatus("");
    try {
      if (value) {
        if (!(await requestNotificationPermission())) {
          Alert.alert(label("Permesso notifiche", "Notification permission"),
            label("Consenti le notifiche nelle impostazioni Android.", "Allow notifications in Android settings."),
            [{ text: label("Chiudi", "Close") }, { text: label("Apri impostazioni", "Open settings"), onPress: () => Linking.openSettings() }]);
          return;
        }
        await wake.enable();
      } else await wake.disable();
    } catch {
      setStatus(label("Impostazione non completata. Riprova.", "Could not complete the change. Try again."));
    } finally {
      setEnabled(await wake.isOn().catch(() => null));
      setBusy(false);
    }
  };

  const test = async () => {
    setBusy(true);
    try {
      if (!(await wake.isOn()) || !(await requestNotificationPermission({ askPermission: false }))) {
        setStatus(label("Attiva le notifiche ULTRON e consenti il permesso Android.", "Enable ULTRON notifications and allow them in Android."));
        return;
      }
      await wake.refresh();
      const result = await testNotify();
      if (!result?.wake?.queued) throw new Error();
      setStatus(label("Avviso accodato. Verifica che arrivi sul telefono.", "Test queued. Check that it arrives on your phone."));
    } catch {
      setStatus(label("Il server non ha accodato l’avviso. Controlla la connessione.", "The server did not queue the test. Check your connection."));
    } finally { setBusy(false); }
  };

  return <ScrollView contentContainerStyle={[styles.content, { paddingTop: top + 16 }]}>
    <Pressable accessibilityRole="button" onPress={() => navigation.goBack()}>
      <Text style={styles.action}>{label("‹ Impostazioni", "‹ Settings")}</Text>
    </Pressable>
    <Text style={styles.title}>{label("Notifiche", "Notifications")}</Text>
    <View style={styles.row}>
      <Text style={styles.text}>{label("Avvisi in background", "Background alerts")}</Text>
      <Switch value={enabled === true} disabled={busy || enabled === null} onValueChange={change}
        accessibilityLabel={label("Avvisi in background", "Background alerts")} />
    </View>
    <Text style={styles.dim}>{label("Gli avvisi mostrano un testo generico.", "Alerts display generic text.")}</Text>
    <Pressable accessibilityRole="button" disabled={busy || !enabled} onPress={test}>
      <Text style={[styles.action, (busy || !enabled) && styles.dim]}>{label("Mandami un avviso di prova", "Send me a test alert")}</Text>
    </Pressable>
    {!!status && <Text accessibilityLiveRegion="polite" style={styles.dim}>{status}</Text>}
        <Text style={styles.section}>{en ? "Call ringtone" : "Suoneria chiamate"}</Text>
        <View style={styles.card}>
          {RINGTONE_OPTS.map(([k, label]) => (
            <TouchableOpacity key={k} testID={"ringtone-" + k} onPress={async () => { setRingtone(k); await saveRingtone(k); previewRing(k, ringVol); }} style={styles.optionRow}>
              <Ionicons name={ringtone === k ? "radio-button-on" : "radio-button-off"} size={20} color={ringtone === k ? theme.primary : theme.textDim} />
              <Text style={styles.rowLabel}>{k === "system" && en ? "Phone ringtone" : label}</Text>
              <Ionicons name={k === "system" ? "phone-portrait-outline" : "play-circle-outline"} size={22} color={theme.textDim} />
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.volRow}>
          <Ionicons name="volume-medium-outline" size={18} color={theme.textDim} />
          <Text style={{ color: theme.textDim, fontSize: 13, marginRight: 2 }}>Volume</Text>
          {[0.25, 0.5, 0.75, 1].map((v) => (
            <TouchableOpacity key={v} testID={"ringvol-" + Math.round(v * 100)} onPress={async () => { setRingVol(v); await saveRingVolume(v); previewRing(ringtone, v); }} style={{ paddingVertical: 6, paddingHorizontal: 14, borderRadius: 10, backgroundColor: Math.abs(ringVol - v) < 0.01 ? theme.primary : theme.card }}>
              <Text style={{ color: Math.abs(ringVol - v) < 0.01 ? "#fff" : theme.text, fontWeight: "700", fontSize: 13 }}>{Math.round(v * 100)}%</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.section}>{en ? "Vibration" : "Vibrazione"}</Text>
        <View style={styles.card}>
          {[["off", en ? "Off" : "Disattivata"], ["standard", "Standard"], ["short", en ? "Short" : "Breve"], ["long", en ? "Long" : "Lunga"]].map(([k, label]) => (
            <TouchableOpacity key={k} testID={"vib-" + k} onPress={async () => { setVibMode(k); await saveVibMode(k); if (k !== "off") { try { Vibration.vibrate(VIB_PATTERNS[k] || VIB_PATTERNS.standard); } catch (e) {} } }} style={styles.optionRow}>
              <Ionicons name={vibMode === k ? "radio-button-on" : "radio-button-off"} size={20} color={vibMode === k ? theme.primary : theme.textDim} />
              <Text style={styles.rowLabel}>{label}</Text>
            </TouchableOpacity>
          ))}
        </View>
  </ScrollView>;
}

const styles = StyleSheet.create({
  volRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 4, paddingBottom: 14, flexWrap: "wrap" },
  rowLabel: { color: theme.text, fontSize: 15, fontWeight: "600", flex: 1 },
  optionRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: theme.bg },
  card: { backgroundColor: theme.card, borderRadius: 14, overflow: "hidden", marginBottom: 10 },
  section: { color: theme.textFaint, fontSize: 12, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 8, marginTop: 6 },
  content: { paddingHorizontal: 20, paddingBottom: 28, gap: 15 },
  title: { color: theme.text, fontSize: 27, fontWeight: "800" },
  text: { color: theme.text, fontSize: 15 },
  dim: { color: theme.textDim, fontSize: 13 },
  action: { color: theme.primary, fontSize: 16, paddingVertical: 8 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
});
