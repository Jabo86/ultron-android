import React, { useState, useEffect, useRef } from "react";
import {
  Alert, View, Text, StyleSheet, TextInput, TouchableOpacity, ActivityIndicator,
  ScrollView, Switch, KeyboardAvoidingView, Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import KeyfileExport from "../components/KeyfileExport";
import { useAuth } from "../context/AuthContext";
import { useI18n } from "../lib/i18n";
import * as api from "../lib/api";
import { RATCHET_PILOT } from "../config";
import { generateRecoveryPhrase, recoveryKeyfile } from "../lib/recoveryPhrase";
import { keygen, signMessage } from "../lib/crypto";
import { saveAppLock } from "../lib/store";
import { isDeviceSecure } from "../lib/biometrics";
import { theme } from "../theme";

const DOMAIN = "ultron.uns";
const normUser = (v) => (v || "").toLowerCase().replace(/[^a-z0-9._-]/g, "");

export default function SignupScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const { signIn } = useAuth();
  const { lang } = useI18n();
  const it = lang !== "en";
  const server = route?.params?.server || api.getServerUrl();
  const [username, setUsername] = useState("");
  const [useLock, setUseLock] = useState(false);
  const [secure, setSecure] = useState(false);
  const [avail, setAvail] = useState(null); // null | true | false
  const [checking, setChecking] = useState(false);
  const [signupUnavailable, setSignupUnavailable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [showKeyExport, setShowKeyExport] = useState(false);
  const [created, setCreated] = useState(null); // { keyfile, lns_name }
  const [saved, setSaved] = useState(false);
  const [reviewPhrase, setReviewPhrase] = useState("");
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
      try { const r = await api.personalCheck(u, server); if (active) setAvail(r?.available === true); }
      catch (e) {
        if (active && e.response?.status === 404) setSignupUnavailable(true);
      }
      finally { if (active) setChecking(false); }
    }, 450);
    return () => { active = false; clearTimeout(tRef.current); };
  }, [username, server]);

  const doSignup = async (confirmed = false) => {
    const u = normUser(username);
    if (u.length < 3 || busy || avail === false) return;
    if (RATCHET_PILOT && !confirmed) {
      if (pending.current?.username !== u) pending.current = { username: u, phrase: generateRecoveryPhrase() };
      setReviewPhrase(pending.current.phrase);
      return;
    }
    setBusy(true); setErr("");
    try {
      // 1) chiavi generate SUL DISPOSITIVO: la privata non viene mai inviata al server
      const lns = `${u}@${DOMAIN}`;
      if (RATCHET_PILOT && pending.current?.username !== u) throw new Error("Nome utente cambiato.");
      if (pending.current?.username !== u) pending.current = { username: u, keypair: keygen() };
      const keys = RATCHET_PILOT ? recoveryKeyfile(u, server, pending.current.phrase) : null;
      const kp = keys
        ? { publicKeyHex: keys.public_key_hex, secretKeyHex: keys.secret_key_hex }
        : pending.current.keypair;
      const signature_hex = signMessage(`ultron-personal-signup-v1:${lns}`, kp.secretKeyHex);
      const r = await api.personalSignup({ username: u, public_key_hex: kp.publicKeyHex, signature_hex }, server);
      if (r.lns_name !== lns) throw new Error(it ? "Indirizzo inatteso dal server." : "Unexpected account address.");
      const keyfile = {
        version: 1, algorithm: "ML-DSA-65", lns_name: r.lns_name, tenant_id: r.tenant_id,
        did: r.did, public_key_hex: kp.publicKeyHex, secret_key_hex: kp.secretKeyHex,
        server_url: server, created_at: r.created_at,
      };
      setSignupUnavailable(false);
      setCreated({ keyfile, lns_name: r.lns_name });
      pending.current = null;
      setReviewPhrase("");
    } catch (e) {
      if (e.response?.status === 404) setSignupUnavailable(true);
      else setErr(api.apiErr(e));
    } finally { setBusy(false); }
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

  if (reviewPhrase && !created) {
    return (
      <ScrollView style={styles.root} contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 24 }]}>
        <Text style={styles.title}>{it ? "Le tue 12 parole" : "Your 12 words"}</Text>
        <Text style={styles.lnsBig}>{username}@{DOMAIN}</Text>
        <Text style={styles.warnTxt}>{reviewPhrase}</Text>
        <Text style={styles.sub}>{it
          ? "Annota le parole in ordine. Per rientrare dopo «Esci» servono queste parole, il tuo nome utente e lo stesso server. Chi conosce le parole può accedere al tuo account."
          : "Write the words down in order. To sign in after signing out, use these words, your username and the same server. Anyone with these words can access your account."}</Text>
        {!!err && <Text style={styles.err}>{err}</Text>}
        <TouchableOpacity style={styles.primaryBtn} onPress={() => doSignup(true)} disabled={busy}>
          <Text style={styles.primaryBtnTxt}>{busy ? (it ? "Creazione…" : "Creating…") : (it ? "Le ho annotate · Crea account" : "I wrote them down · Create account")}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.back} onPress={() => setReviewPhrase("")} disabled={busy}>
          <Text style={styles.backTxt}>{it ? "Indietro" : "Back"}</Text>
        </TouchableOpacity>
      </ScrollView>
    );
  }

  if (created) {
    return (
      <ScrollView style={styles.root} contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 24 }]}>
        <View style={styles.okBadge}><Ionicons name="shield-checkmark-outline" size={30} color={theme.accent} /></View>
        <Text style={styles.title} testID="signup-done-title">{it ? "Account creato" : "Account created"}</Text>
        <Text style={styles.lnsBig} testID="signup-done-lns">{created.lns_name}</Text>
        <View style={styles.warnBox}>
          <Text style={styles.warnTxt}>
            {RATCHET_PILOT
              ? (it ? "Puoi rientrare con le 12 parole annotate. La copia cifrata della chiave è facoltativa." : "You can sign in with the 12 words you wrote down. An encrypted keyfile copy is optional.")
              : it
              ? "ULTRON genera la chiave privata sul telefono. Se perdi l’accesso al dispositivo, puoi rientrare con il file chiave cifrato e la sua frase segreta."
              : "ULTRON generates your private key on the phone. If you lose access to the device, use the encrypted keyfile and its passphrase to sign in again."}
          </Text>
        </View>

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
        <TouchableOpacity style={[styles.primaryBtn, busy && styles.btnDim]} onPress={() => {
          if (saved || RATCHET_PILOT) { enter(); return; }
          Alert.alert(it ? "Continuare senza copia?" : "Continue without a copy?",
            it ? "Se perdi il telefono prima di esportare la chiave da Impostazioni, puoi perdere l’accesso all’account." : "If you lose the phone before exporting the key in Settings, you can lose access to the account.",
            [{ text: it ? "Annulla" : "Cancel", style: "cancel" },
              { text: it ? "Continua" : "Continue", onPress: enter }]);
        }} disabled={busy} testID="signup-enter">
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnTxt}>{it ? "Entra in ULTRON" : "Enter ULTRON"}</Text>}
        </TouchableOpacity>
        <TouchableOpacity style={styles.back} disabled={busy} onPress={() => setShowKeyExport(true)} testID="signup-save-keyfile">
          <Text style={styles.backTxt}>{it ? "Salva una copia cifrata" : "Save an encrypted copy"}</Text>
        </TouchableOpacity>
        {showKeyExport && <KeyfileExport keyfile={created.keyfile} english={!it}
          onClose={() => setShowKeyExport(false)} onShared={() => { setSaved(true); setShowKeyExport(false); }} />}
        {!saved && <Text style={styles.hintCenter}>{it ? "Puoi salvare il file chiave anche dopo, dalle Impostazioni." : "You can save the keyfile later in Settings."}</Text>}

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
        <Text style={styles.hint}>{server}</Text>
        {signupUnavailable && <Text accessibilityLiveRegion="polite" style={styles.err}>
          {it ? "La registrazione non è disponibile su questo server. Puoi riprovare dopo l’aggiornamento del server o tornare all’accesso e scegliere un altro indirizzo."
            : "Registration is unavailable on this server. Try again after the server update, or go back to sign-in and choose another address."}
        </Text>}
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
          onPress={() => doSignup()} disabled={username.length < 3 || avail === false || busy} testID="signup-submit">
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
