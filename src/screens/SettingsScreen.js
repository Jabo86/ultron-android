import React, { useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Constants from "expo-constants";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { useAuth } from "../context/AuthContext";
import { ACCENTS, BACKGROUNDS, set as setLook, useLook } from "../lib/appearance";
import { authenticate } from "../lib/biometrics";
import { useI18n } from "../lib/i18n";
import { suppressLock } from "../lib/lockGuard";
import { UI_LANGS } from "../lib/locales";
import { loadAppLock, loadKeyfile, saveAppLock } from "../lib/store";
import { theme } from "../theme";

function Action({ children, onPress, disabled }) {
  return <Pressable style={styles.action} accessibilityRole="button" onPress={onPress} disabled={disabled}>
    <Text style={[styles.actionText, disabled && styles.dim]}>{children}</Text>
  </Pressable>;
}

function Options({ choices, selected, choose, tint }) {
  return <View style={styles.options}>
    {choices.map(({ id, label, color }) => (
      <Pressable key={id} onPress={() => choose(id)} accessibilityRole="button"
        accessibilityState={{ selected: id === selected }}
        style={[styles.option, id === selected && { borderColor: tint }]}>
        {color && <View style={[styles.swatch, { backgroundColor: color }]} />}
        <Text style={styles.actionText}>{label}</Text>
      </Pressable>
    ))}
  </View>;
}

export default function SettingsScreen({ navigation }) {
  const { user, signOut } = useAuth();
  const { lang, setLang, t } = useI18n();
  const { top, bottom } = useSafeAreaInsets();
  const look = useLook();
  const [lock, setLock] = useState(null);
  const [busy, setBusy] = useState(false);
  const [languages, showLanguages] = useState(false);
  const english = lang === "en";
  const label = (it, en) => english ? en : it;

  useEffect(() => {
    loadAppLock().then((value) => setLock(value ?? true)).catch(() => {});
  }, []);

  const changeLock = async (value) => {
    setBusy(true);
    try {
      if (!(await authenticate(label("Conferma il blocco app", "Confirm app lock")))) return;
      await saveAppLock(value);
      setLock(value);
    } catch {
      Alert.alert(label("Blocco app", "App lock"), label("Impostazione non salvata.", "Could not save the setting."));
    } finally { setBusy(false); }
  };

  const backup = async () => {
    setBusy(true);
    let uri;
    try {
      if (!(await authenticate(label("Autorizza la copia del file chiave", "Authorize key file export")))) return;
      const keyfile = await loadKeyfile();
      if (!keyfile || !(await Sharing.isAvailableAsync())) throw new Error();
      uri = FileSystem.cacheDirectory + "ultron-account-key.json";
      await FileSystem.writeAsStringAsync(uri, JSON.stringify(keyfile));
      suppressLock();
      await Sharing.shareAsync(uri, { mimeType: "application/json" });
    } catch {
      Alert.alert(label("File chiave", "Key file"), label("Copia non disponibile.", "Export unavailable."));
    } finally {
      if (uri) await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
      setBusy(false);
    }
  };

  return <ScrollView style={{ backgroundColor: look.color }}
    contentContainerStyle={[styles.content, { paddingTop: top + 16, paddingBottom: bottom + 24 }]}>
    <Text style={styles.title}>{t("tab.settings")}</Text>
    <Text style={styles.heading}>{label("Account", "Account")}</Text>
    <Text style={styles.value} selectable>{user?.lns}</Text>
    <Text style={styles.dim} selectable>{user?.server}</Text>

    <Text style={styles.heading}>{label("Privacy e sicurezza", "Privacy and security")}</Text>
    <View style={styles.row}>
      <Text style={styles.value}>{label("Blocco app con PIN o impronta", "App lock with PIN or biometrics")}</Text>
      <Switch accessibilityLabel={label("Blocco app", "App lock")} value={lock === true}
        disabled={busy || lock === null} onValueChange={changeLock} />
    </View>
    <Text style={styles.dim}>{label("Il file chiave dà accesso al tuo account. Conserva la copia in un posto sicuro.", "The key file grants access to your account. Keep the copy somewhere safe.")}</Text>
    <Action disabled={busy} onPress={backup}>{label("Esporta file chiave", "Export key file")}</Action>

    <Text style={styles.heading}>{label("Notifiche", "Notifications")}</Text>
    <Action onPress={() => navigation.navigate("Notifications")}>{label("Gestisci e prova le notifiche", "Manage and test notifications")}</Action>

    <Text style={styles.heading}>{label("Aspetto e lingua", "Appearance and language")}</Text>
    <Text style={styles.dim}>{label("Colore", "Accent")}</Text>
    <Options choices={ACCENTS} selected={look.accent} choose={(accent) => setLook({ accent })} tint={look.tint} />
    <Text style={styles.dim}>{label("Sfondo", "Background")}</Text>
    <Options choices={BACKGROUNDS} selected={look.bg} choose={(bg) => setLook({ bg })} tint={look.tint} />
    <Action onPress={() => showLanguages(!languages)}>{label("Lingua", "Language")} · {lang.toUpperCase()}</Action>
    {languages && <Options choices={UI_LANGS.map((item) => ({ id: item.code, label: item.native }))}
      selected={lang} choose={(code) => { setLang(code); showLanguages(false); }} tint={look.tint} />}

    <Text style={styles.heading}>ULTRON Messaggi</Text>
    <Text style={styles.dim}>{label("Versione", "Version")} {Constants.expoConfig?.version}</Text>
    <Action onPress={() => Alert.alert(label("Esci dall’account", "Sign out"),
      label("Per rientrare ti servirà il file chiave.", "You will need the key file to sign in again."),
      [{ text: label("Annulla", "Cancel"), style: "cancel" }, { text: label("Esci", "Sign out"), style: "destructive", onPress: signOut }])}>
      {label("Esci dall’account", "Sign out")}
    </Action>
  </ScrollView>;
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, gap: 9 },
  title: { color: theme.text, fontSize: 27, fontWeight: "800" },
  heading: { color: theme.text, fontSize: 18, fontWeight: "700", marginTop: 18 },
  value: { color: theme.text, fontSize: 15, flexShrink: 1 },
  dim: { color: theme.textDim, fontSize: 13, lineHeight: 19 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12 },
  action: { backgroundColor: theme.surface, padding: 14, borderRadius: 12 },
  actionText: { color: theme.text, fontSize: 14 },
  options: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  option: { flexDirection: "row", gap: 6, alignItems: "center", borderColor: theme.border, borderWidth: 1, padding: 9, borderRadius: 9 },
  swatch: { height: 12, width: 12, borderRadius: 6, borderColor: theme.textDim, borderWidth: 1 },
});
