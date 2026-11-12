import React, { useState, useEffect, useRef } from "react";
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity, ActivityIndicator,
  ScrollView, Switch, Alert, KeyboardAvoidingView, Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { useAuth } from "../context/AuthContext";
import { useI18n } from "../lib/i18n";
import * as api from "../lib/api";
import { keygen, signMessage } from "../lib/crypto";
import { saveAppLock } from "../lib/store";
import { isDeviceSecure } from "../lib/biometrics";
import { theme } from "../theme";

const DOMAIN = "ultron.uns";
const normUser = (v) => (v || "").toLowerCase().replace(/[^a-z0-9._-]/g, "");

export default function SignupScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const { signIn } = useAuth();
  const { lang } = useI18n();
  const it = lang !== "en";
  const [username, setUsername] = useState("");
  const [useLock, setUseLock] = useState(false);
  const [secure, setSecure] = useState(false);
  const [avail, setAvail] = useState(null); // null | true | false
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [created, setCreated] = useState(null); // { keyfile, lns_name }
  const [saved, setSaved] = useState(false);
  const tRef = useRef(null);
  const pending = useRef(null);

  useEffect(() => { isDeviceSecure().then(setSecure).catch(() => {}); }, []);

  useEffect(() => {
    const u = normUser(username);
    let active = true;
    setAvail(null);
    setChecking(false);
    if (u.length < 3) return;
    if (tRef.current) clearTimeout(tRef.current);
    tRef.current = setTimeout(async () => {
      setChecking(true);
      try { const r = await api.personalCheck(u); if (active) setAvail(r?.available === true); }
      catch { if (active) setAvail(null); }
      finally { if (active) setChecking(false); }
    }, 450);
    return () => { active = false; clearTimeout(tRef.current); };
  }, [username]);

  const doSignup = async () => {
    const u = normUser(username);
    if (u.length < 3 || busy || avail === false) return;
    setBusy(true); setErr("");
    try {
      // 1) chiavi generate SUL DISPOSITIVO: la privata non viene mai inviata al server
      if (pending.current?.username !== u) pending.current = { username: u, keypair: keygen() };
      const kp = pending.current.keypair;
      const lns = `${u}@${DOMAIN}`;
      const signature_hex = signMessage(`ultron-personal-signup-v1:${lns}`, kp.secretKeyHex);
      const r = await api.personalSignup({ username: u, public_key_hex: kp.publicKeyHex, signature_hex });
      if (r.lns_name !== lns) throw new Error(it ? "Indirizzo inatteso dal server." : "Unexpected account address.");
      const keyfile = {
        version: 1, algorithm: "ML-DSA-65", lns_name: r.lns_name, tenant_id: r.tenant_id,
        did: r.did, public_key_hex: kp.publicKeyHex, secret_key_hex: kp.secretKeyHex,
        server_url: api.getServerUrl(), created_at: r.created_at,
      };
      setCreated({ keyfile, lns_name: r.lns_name });
      pending.current = null;
    } catch (e) {
      setErr(api.apiErr(e));
    } finally { setBusy(false); }
  };

  const shareKeyfile = async () => {
    if (!created) return;
    let uri;
    try {
      const fn = `ultron-key-${created.lns_name.replace(/[^\w.\-]/g, "_")}.json`;
      uri = FileSystem.cacheDirectory + fn;
      await FileSystem.writeAsStringAsync(uri, JSON.stringify(created.keyfile, null, 2), { encoding: FileSystem.EncodingType.UTF8 });
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { mimeType: "application/json", dialogTitle: it ? "Salva il tuo file chiave" : "Save your keyfile" });
      else throw new Error(it ? "Salvataggio non disponibile su questo dispositivo." : "Saving is unavailable on this device.");
      setSaved(true);
    } catch (e) { Alert.alert(it ? "File chiave" : "Key file", e.message); }
    finally { if (uri) await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {}); }
  };

  const enter = async () => {
    if (!created || busy) return;
    setBusy(true); setErr("");
    try {
      if (useLock && secure) await saveAppLock(true);
      await signIn(created.keyfile, { persist: true });
    } catch (e) { setErr(api.apiErr(e)); }
    finally { setBusy(false); }
  };

  if (created) {
    return (
      <ScrollView style={styles.root} contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 24 }]}>
        <View style={styles.okBadge}><Ionicons name="shield-checkmark-outline" size={30} color={theme.accent} /></View>
        <Text style={styles.title} testID="signup-done-title">{it ? "Account creato" : "Account created"}</Text>
        <Text style={styles.lnsBig} testID="signup-done-lns">{created.lns_name}</Text>
        <View style={styles.warnBox}>
          <Text style={styles.warnTxt}>
            {it
              ? "La tua chiave privata esiste SOLO su questo telefono: il server non la ha e non può recuperarla. Salvane una copia adesso: senza il file chiave perdi l'accesso all'account."
              : "Your private key exists ONLY on this phone: the server does not have it and cannot recover it. Save a copy now: without the keyfile you lose access."}
          </Text>
        </View>
        <TouchableOpacity style={styles.primaryBtn} onPress={shareKeyfile} testID="signup-save-keyfile">
          <Text style={styles.primaryBtnTxt}>{it ? "Salva il file chiave" : "Save the keyfile"}</Text>
        </TouchableOpacity>
        {secure && (
          <View style={styles.switchRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.switchLabel}>{it ? "Blocco app (PIN / impronta)" : "App lock (PIN / biometrics)"}</Text>
              <Text style={styles.hint}>{it ? "Chiede il PIN o l'impronta del telefono ad ogni apertura." : "Asks for your phone PIN or fingerprint at every launch."}</Text>
            </View>
            <Switch value={useLock} onValueChange={setUseLock} testID="signup-applock-switch"
              trackColor={{ true: theme.primary, false: theme.border }} thumbColor="#fff" />
          </View>
        )}
        {!!err && <Text style={styles.err} testID="signup-error">{err}</Text>}
        <TouchableOpacity style={[styles.primaryBtn, !saved && styles.btnDim]} onPress={enter} disabled={!saved || busy} testID="signup-enter">
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnTxt}>{it ? "Entra in ULTRON" : "Enter ULTRON"}</Text>}
        </TouchableOpacity>
        {!saved && <Text style={styles.hintCenter}>{it ? "Salva prima il file chiave per continuare." : "Save the keyfile first to continue."}</Text>}

      </ScrollView>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 16 }]} keyboardShouldPersistTaps="handled">
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.back} testID="signup-back">
          <Ionicons name="chevron-back-outline" size={22} color={theme.textDim} />
          <Text style={styles.backTxt}>{it ? "Indietro" : "Back"}</Text>
        </TouchableOpacity>

        <Text style={styles.title}>{it ? "Crea il tuo account personale" : "Create your personal account"}</Text>
        <Text style={styles.sub}>
          {it ? "Scegli un nome utente: sarà il tuo indirizzo ULTRON. Le chiavi vengono generate su questo dispositivo."
              : "Pick a username: it becomes your ULTRON address. Keys are generated on this device."}
        </Text>

        <Text style={styles.label}>{it ? "Nome utente" : "Username"}</Text>
        <View style={styles.lnsRow}>
          <TextInput
            style={styles.input} value={username} onChangeText={(v) => setUsername(normUser(v))}
            placeholder="mario.rossi" placeholderTextColor={theme.textFaint}
            autoCapitalize="none" autoCorrect={false} maxLength={32} testID="signup-username"
          />
          <Text style={styles.domain}>@{DOMAIN}</Text>
        </View>
        <View style={styles.availRow}>
          {checking ? <ActivityIndicator size="small" color={theme.textDim} />
            : avail === true ? <Text style={styles.availOk} testID="signup-avail-ok">{it ? "✓ disponibile" : "✓ available"}</Text>
            : avail === false ? <Text style={styles.availNo} testID="signup-avail-no">{it ? "✗ già in uso" : "✗ already taken"}</Text>
            : <Text style={styles.hint}>{it ? "Minimo 3 caratteri: a-z, 0-9, . _ -" : "At least 3 chars: a-z, 0-9, . _ -"}</Text>}
        </View>

        <View style={styles.infoBox}>
          <Text style={styles.infoTxt}>
            {it ? "La chiave privata rimane sul dispositivo."
                : "Your private key stays on this device."}
          </Text>
        </View>

        {!!err && <Text style={styles.err} testID="signup-error">{err}</Text>}

        <TouchableOpacity style={[styles.primaryBtn, (username.length < 3 || avail === false || busy) && styles.btnDim]}
          onPress={doSignup} disabled={username.length < 3 || avail === false || busy} testID="signup-submit">
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnTxt}>{it ? "Crea account" : "Create account"}</Text>}
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "transparent" },
  scroll: { padding: 24, paddingBottom: 60 },
  back: { flexDirection: "row", alignItems: "center", marginBottom: 18 },
  backTxt: { color: theme.textDim, fontSize: 14, fontWeight: "600" },
  title: { color: theme.text, fontSize: 26, fontWeight: "900", marginBottom: 8 },
  sub: { color: theme.textDim, fontSize: 14, lineHeight: 21, marginBottom: 24 },
  label: { color: theme.textDim, fontSize: 12, fontWeight: "800", letterSpacing: 1, marginBottom: 8, marginTop: 8 },
  lnsRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  input: { flex: 1, backgroundColor: theme.surface, borderColor: theme.border, borderWidth: 1, borderRadius: 12, color: theme.text, paddingHorizontal: 14, paddingVertical: 13, fontSize: 15 },
  domain: { color: theme.primary, fontSize: 14, fontWeight: "800" },
  availRow: { minHeight: 22, justifyContent: "center", marginTop: 8 },
  availOk: { color: theme.accent, fontSize: 13, fontWeight: "700" },
  availNo: { color: theme.danger, fontSize: 13, fontWeight: "700" },
  hint: { color: theme.textFaint, fontSize: 12, lineHeight: 17 },
  hintCenter: { color: theme.textFaint, fontSize: 12, textAlign: "center", marginTop: 10 },
  switchRow: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 22, backgroundColor: theme.surface, borderColor: theme.border, borderWidth: 1, borderRadius: 12, padding: 14 },
  switchLabel: { color: theme.text, fontSize: 14, fontWeight: "700", marginBottom: 4 },
  infoBox: { marginTop: 22, borderRadius: 12, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.surfaceAlt, padding: 14 },
  infoTxt: { color: theme.textDim, fontSize: 13, lineHeight: 19 },
  warnBox: { marginTop: 18, borderRadius: 12, borderWidth: 1, borderColor: "#50C87866", backgroundColor: "#2A2210", padding: 14 },
  warnTxt: { color: "#F7DFA0", fontSize: 13, lineHeight: 19 },
  err: { color: "#FFB3BD", fontSize: 13, marginTop: 16 },
  primaryBtn: { backgroundColor: theme.primary, borderRadius: 14, paddingVertical: 16, alignItems: "center", marginTop: 24 },
  primaryBtnTxt: { color: "#fff", fontSize: 16, fontWeight: "800" },
  btnDim: { opacity: 0.45 },
  okBadge: { alignSelf: "center", width: 62, height: 62, borderRadius: 31, alignItems: "center", justifyContent: "center", backgroundColor: theme.surface, borderColor: theme.accent, borderWidth: 1, marginBottom: 18 },
  lnsBig: { color: theme.primary, fontSize: 18, fontWeight: "800", marginBottom: 4 },
});
