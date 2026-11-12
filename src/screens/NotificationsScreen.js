import React, { useEffect, useState } from "react";
import { Alert, Linking, Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useI18n } from "../lib/i18n";
import { registerForPush } from "../lib/notifications";
import { testNotify } from "../lib/api";
import * as wake from "../lib/wake";
import { theme } from "../theme";

export default function NotificationsScreen({ navigation }) {
  const { top } = useSafeAreaInsets();
  const { lang } = useI18n();
  const label = (it, en) => lang === "en" ? en : it;
  const [enabled, setEnabled] = useState(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  useEffect(() => { wake.isOn().then(setEnabled).catch(() => {}); }, []);

  const change = async (value) => {
    setBusy(true);
    setStatus("");
    try {
      if (value) {
        if (!(await registerForPush())) {
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
  </ScrollView>;
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, paddingBottom: 28, gap: 15 },
  title: { color: theme.text, fontSize: 27, fontWeight: "800" },
  text: { color: theme.text, fontSize: 15 },
  dim: { color: theme.textDim, fontSize: 13 },
  action: { color: theme.primary, fontSize: 16, paddingVertical: 8 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
});
