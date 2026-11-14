import React, { useRef, useState } from "react";
import { Alert, Modal, View, Text, TextInput, Pressable, StyleSheet } from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { MAX_KEY_PASSWORD, MIN_KEY_PASSWORD, protectKeyfile } from "../lib/keyfileProtection";
import { randomHex } from "../lib/crypto";
import { withSystemActivity } from "../lib/lockGuard";
import { theme } from "../theme";

export default function KeyfileExport({ keyfile, english, onClose, onShared }) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const valid = password.length >= MIN_KEY_PASSWORD && password === confirmation && password.trim().length >= MIN_KEY_PASSWORD;

  const share = async () => {
    if (!valid || running.current) return;
    running.current = true;
    setBusy(true);
    let uri;
    let shared = false;
    try {
      if (!(await Sharing.isAvailableAsync())) throw new Error();
      const protectedFile = await protectKeyfile(keyfile, password);
      uri = FileSystem.cacheDirectory + `ultron-chiave-cifrata-${randomHex(6)}.json`;
      await FileSystem.writeAsStringAsync(uri, JSON.stringify(protectedFile));
      await withSystemActivity(() => Sharing.shareAsync(uri, { mimeType: "application/json" }));
      shared = true;
    } catch {
      Alert.alert("ULTRON", english ? "Could not share the encrypted keyfile." : "Impossibile condividere il file chiave cifrato.");
    } finally {
      if (uri) await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
      running.current = false;
      setBusy(false);
    }
    if (shared) onShared();
  };

  return <Modal transparent animationType="fade" onRequestClose={() => !busy && onClose()}>
    <View style={s.backdrop}>
      <View style={s.card}>
        <Text style={s.title}>{english ? "Encrypt keyfile" : "Cifra il file chiave"}</Text>
        <Text style={s.copy}>{english
          ? "Use a unique passphrase of at least 16 characters. You will need it to open this copy."
          : "Usa una frase segreta unica di almeno 16 caratteri. Ti servirà per aprire questa copia."}</Text>
        <TextInput style={s.input} secureTextEntry autoCorrect={false} autoCapitalize="none" maxLength={MAX_KEY_PASSWORD}
          editable={!busy} value={password} onChangeText={setPassword} placeholder={english ? "Passphrase" : "Frase segreta"}
          placeholderTextColor={theme.textFaint} testID="keyfile-passphrase" />
        <TextInput style={s.input} secureTextEntry autoCorrect={false} autoCapitalize="none" maxLength={MAX_KEY_PASSWORD}
          editable={!busy} value={confirmation} onChangeText={setConfirmation} placeholder={english ? "Repeat passphrase" : "Ripeti la frase segreta"}
          placeholderTextColor={theme.textFaint} testID="keyfile-passphrase-confirm" />
        <Pressable style={[s.action, (!valid || busy) && s.disabled]} disabled={!valid || busy} onPress={share} accessibilityRole="button">
          <Text style={s.actionText}>{busy ? (english ? "Encrypting…" : "Cifratura…") : (english ? "Encrypt and share" : "Cifra e condividi")}</Text>
        </Pressable>
        <Pressable style={s.cancel} disabled={busy} onPress={onClose} accessibilityRole="button">
          <Text style={s.copy}>{english ? "Cancel" : "Annulla"}</Text>
        </Pressable>
      </View>
    </View>
  </Modal>;
}

const s = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: "center", padding: 20, backgroundColor: "rgba(0,0,0,0.7)" },
  card: { backgroundColor: theme.surface, borderRadius: 16, padding: 20, gap: 12 },
  title: { color: theme.text, fontWeight: "800", fontSize: 20 },
  copy: { color: theme.textDim, fontSize: 14 },
  input: { borderWidth: 1, borderColor: theme.border, borderRadius: 10, padding: 12, color: theme.text },
  action: { backgroundColor: theme.primary, padding: 12, alignItems: "center", borderRadius: 10 },
  actionText: { color: "#fff", fontWeight: "700" },
  disabled: { opacity: 0.5 },
  cancel: { padding: 8, alignItems: "center" },
});
