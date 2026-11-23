import React, { useRef, useState } from "react";
import { Alert, Modal, View, Pressable, StyleSheet } from "react-native";
import { Text, TextInput } from "./HudText";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { MAX_KEY_PASSWORD, MIN_KEY_PASSWORD, protectKeyfile } from "../lib/keyfileProtection";
import { generateRecoveryPhrase } from "../lib/recoveryPhrase";
import { randomHex } from "../lib/crypto";
import { withSystemActivity } from "../lib/lockGuard";
import { theme } from "../theme";

export default function KeyfileExport({ keyfile, english, onClose, onShared, onSaved }) {
  const [password, setPassword] = useState("");
  const [generated, setGenerated] = useState("");
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
    let saved = false;
    let target;
    try {
      if (onSaved) {
        const storage = FileSystem.StorageAccessFramework;
        const folder = await withSystemActivity(() => storage.requestDirectoryPermissionsAsync());
        if (!folder.granted) return;
        const encrypted = JSON.stringify(await protectKeyfile(keyfile, password));
        target = await storage.createFileAsync(folder.directoryUri,
          `unvor-chiave-cifrata-${randomHex(6)}`, "application/json");
        await storage.writeAsStringAsync(target, encrypted);
        if (await storage.readAsStringAsync(target) !== encrypted) throw new Error("Keyfile readback failed");
        saved = true;
      } else {
        if (!(await Sharing.isAvailableAsync())) throw new Error();
        const protectedFile = await protectKeyfile(keyfile, password);
        uri = FileSystem.cacheDirectory + `unvor-chiave-cifrata-${randomHex(6)}.json`;
        await FileSystem.writeAsStringAsync(uri, JSON.stringify(protectedFile));
        await withSystemActivity(() => Sharing.shareAsync(uri, { mimeType: "application/json" }));
        shared = true;
      }
    } catch {
      if (target) await FileSystem.StorageAccessFramework.deleteAsync(target, { idempotent: true }).catch(() => {});
      Alert.alert("UNVOR", onSaved
        ? (english ? "Could not save and verify the encrypted keyfile." : "Impossibile salvare e verificare il file chiave cifrato.")
        : (english ? "Could not share the encrypted keyfile." : "Impossibile condividere il file chiave cifrato."));
    } finally {
      if (uri) await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
      running.current = false;
      setBusy(false);
    }
    if (saved) onSaved();
    if (shared) onShared();
  };

  return <Modal transparent animationType="fade" onRequestClose={() => !busy && onClose()}>
    <View style={s.backdrop}>
      <View style={s.card}>
        <Text style={s.title}>{english ? "Encrypt keyfile" : "Cifra il file chiave"}</Text>
        <Text style={s.copy}>{english
          ? "Choose and save a separate passphrase of at least 16 characters. You will need it to open this JSON."
          : "Scegli e conserva una frase segreta separata di almeno 16 caratteri. Ti servirà per aprire questo JSON."}</Text>
        {!onSaved && (
        <Pressable disabled={busy} accessibilityRole="button" onPress={() => {
          const phrase = generateRecoveryPhrase();
          setGenerated(phrase);
          setPassword(phrase);
          setConfirmation("");
        }}>
          <Text style={s.actionText}>{english ? "Generate 12 words" : "Genera 12 parole"}</Text>
        </Pressable>
        )}
        {!!generated && <Text style={s.copy}>{generated}</Text>}
        {!!generated && <Text style={s.copy}>{english
          ? "Write them down in order. You will need both the words and the encrypted file."
          : "Annotale in ordine. Per il recupero servono sia le parole sia il file cifrato."}</Text>}
        <TextInput style={s.input} secureTextEntry autoCorrect={false} autoCapitalize="none" maxLength={MAX_KEY_PASSWORD}
          editable={!busy} value={password} onChangeText={(value) => { setGenerated(""); setPassword(value); }} placeholder={english ? "Passphrase" : "Frase segreta"}
          placeholderTextColor={theme.textFaint} testID="keyfile-passphrase" />
        <TextInput style={s.input} secureTextEntry autoCorrect={false} autoCapitalize="none" maxLength={MAX_KEY_PASSWORD}
          editable={!busy} value={confirmation} onChangeText={setConfirmation} placeholder={english ? "Repeat passphrase" : "Ripeti la frase segreta"}
          placeholderTextColor={theme.textFaint} testID="keyfile-passphrase-confirm" />
        <Pressable style={[s.action, (!valid || busy) && s.disabled]} disabled={!valid || busy} onPress={share} accessibilityRole="button">
          <Text style={s.actionText}>{busy ? (english ? "Saving…" : "Salvataggio…")
            : onSaved ? (english ? "Choose folder and save" : "Scegli cartella e salva")
              : (english ? "Encrypt and share" : "Cifra e condividi")}</Text>
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
