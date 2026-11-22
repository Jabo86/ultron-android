import React, { useState, useEffect, useRef } from "react";
import { Alert, View, StyleSheet, TouchableOpacity, ActivityIndicator, ScrollView, Switch, KeyboardAvoidingView, NativeModules, Platform } from "react-native";
import { Text, TextInput } from "../components/HudText";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import KeyfileExport from "../components/KeyfileExport";
import { useAuth } from "../context/AuthContext";
import { useI18n } from "../lib/i18n";
import * as api from "../lib/api";
import { DEFAULT_SERVER, RATCHET_PILOT } from "../config";
import { generateRecoveryPhrase, recoveryKeyfile } from "../lib/recoveryPhrase";
import RecoveryWordGrid from "../components/RecoveryWordGrid";
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
  const [wordsConfirmed, setWordsConfirmed] = useState(false);
  const [copyStatus, setCopyStatus] = useState("");
  const [reviewPhrase, setReviewPhrase] = useState("");
  const tRef = useRef(null);
  const pending = useRef(null);
  const submitting = useRef(false);

  const signupError = (error) => {
    if (["ERR_NETWORK", "ECONNABORTED", "ETIMEDOUT"].includes(error?.code)) {
      return it
        ? "Il gateway UNVOR non ha risposto. Controlla la connessione e riprova da questa schermata. Le chiavi restano le stesse."
        : "The UNVOR gateway did not respond. Check your connection and retry from this screen. Your keys stay the same.";
    }
    if (error?.response?.status === 404) {
      return it ? "La registrazione non è disponibile sul gateway selezionato." : "Signup is unavailable on the selected gateway.";
    }
    return api.apiErr(error);
  };

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
    if (u.length < 3 || !/[a-z0-9]/.test(u) || submitting.current || (!confirmed && avail === false)) return;
    if (RATCHET_PILOT && !confirmed) {
      try {
        if (pending.current?.username !== u || pending.current.server !== server) {
          const phrase = generateRecoveryPhrase();
          pending.current = { username: u, server, phrase, keyfile: recoveryKeyfile(u, server, phrase) };
          setSaved(false);
          setWordsConfirmed(false);
          setCopyStatus("");
        }
        setErr("");
        setReviewPhrase(pending.current.phrase);
      } catch (error) { setErr(api.apiErr(error)); }
      return;
    }
    if (RATCHET_PILOT && (!saved || !wordsConfirmed || pending.current?.username !== u || pending.current.server !== server)) return;
    submitting.current = true;
    setBusy(true); setErr("");
    try {
      // 1) chiavi generate SUL DISPOSITIVO: la privata non viene mai inviata al server
      const lns = `${u}@${DOMAIN}`;
      if (pending.current?.username !== u) pending.current = { username: u, keypair: keygen() };
      const keys = RATCHET_PILOT ? pending.current.keyfile : null;
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
      setErr(signupError(e));
    } finally { submitting.current = false; setBusy(false); }
  };

  const copyWords = () => {
    Alert.alert(it ? "Copiare le 12 parole?" : "Copy the 12 words?",
      it ? "Incollale solo in un gestore di password fidato. Copiarle negli appunti non le salva." : "Paste them only into a trusted password manager. Copying to the clipboard does not save them.",
      [{ text: it ? "Annulla" : "Cancel", style: "cancel" }, {
        text: it ? "Copia" : "Copy",
        onPress: async () => {
          try {
            await NativeModules.LatticeDeviceInfo.copyRecoveryWords(reviewPhrase);
            setCopyStatus(it ? "Parole copiate. Incollale in un posto sicuro." : "Words copied. Paste them somewhere safe.");
          } catch {
            setCopyStatus(it ? "Copia non riuscita. Puoi annotare le parole in ordine." : "Copy failed. You can write down the words in order.");
          }
        },
      }]);
  };
  const enter = async () => {
    if (!created || submitting.current || (RATCHET_PILOT && (!saved || !wordsConfirmed))) return;
    submitting.current = true;
    setBusy(true); setErr("");
    try {
      if (useLock && secure) await saveAppLock(true);
      await signIn(created.keyfile, { persist: true });
    } catch (e) { setErr(signupError(e)); }
    finally { submitting.current = false; setBusy(false); }
  };

  if (reviewPhrase && !created) {
    return (
      <ScrollView style={styles.root} contentContainerStyle={[styles.scroll, { paddingTop: insets.top + 24 }]}>
        <Text style={styles.title}>{it ? "Salva i dati di recupero" : "Save your recovery information"}</Text>
        <Text style={styles.lnsBig}>{username}@{DOMAIN}</Text>
        <RecoveryWordGrid words={reviewPhrase.split(" ")} italian={it} />
        <Text style={styles.sub}>{it
          ? "Conserva le 12 parole in ordine, insieme al nome utente. Chi le conosce può accedere al tuo account."
          : "Save the 12 words in order together with your username. Anyone who knows them can access your account."}</Text>
        <TouchableOpacity style={styles.secondaryBtn} onPress={copyWords} disabled={busy}
          accessibilityRole="button" testID="signup-copy-words">
          <Text style={styles.backTxt}>{it ? "Copia le 12 parole" : "Copy the 12 words"}</Text>
        </TouchableOpacity>
        {!!copyStatus && <Text style={styles.hint} accessibilityLiveRegion="polite">{copyStatus}</Text>}
        <TouchableOpacity style={styles.secondaryBtn} onPress={() => setShowKeyExport(true)} disabled={busy}
          accessibilityRole="button" testID="signup-save-keyfile">
          <Text style={styles.backTxt}>{saved
            ? (it ? "JSON cifrato salvato · Salva un’altra copia" : "Encrypted JSON saved · Save another copy")
            : (it ? "Salva il file JSON cifrato" : "Save the encrypted JSON file")}</Text>
        </TouchableOpacity>
        {showKeyExport && <KeyfileExport keyfile={pending.current.keyfile} english={!it}
          onClose={() => setShowKeyExport(false)} onSaved={() => { setSaved(true); setShowKeyExport(false); }} />}
        <View style={styles.warnBox}>
          <Text style={styles.warnTxt}>{it
            ? "Se perdi il telefono o disinstalli UNVOR senza una copia di recupero utilizzabile, rischi di perdere l’accesso all’account. Per usare il file JSON ti serve anche la sua frase segreta."
            : "If you lose your phone or uninstall UNVOR without a usable recovery copy, you could lose access to your account. The JSON file also requires its own passphrase."}</Text>
        </View>
        <TouchableOpacity style={styles.switchRow} disabled={!saved || busy}
          onPress={() => setWordsConfirmed(value => !value)} accessibilityRole="checkbox"
          accessibilityState={{ checked: wordsConfirmed, disabled: !saved || busy }} testID="signup-confirm-backup">
          <Ionicons name={wordsConfirmed ? "checkbox-outline" : "square-outline"} size={22} color={theme.primary} />
          <Text style={[styles.switchLabel, styles.flex]}>{it
            ? "Confermo di aver conservato il file JSON, la sua frase segreta e le 12 parole."
            : "I confirm that I saved the JSON file, its passphrase and the 12 recovery words."}</Text>
        </TouchableOpacity>
        {!!err && <Text style={styles.err} accessibilityLiveRegion="polite" testID="signup-error">{err}</Text>}
        <TouchableOpacity style={[styles.primaryBtn, (!saved || !wordsConfirmed || busy) && styles.btnDim]}
          onPress={() => doSignup(true)} disabled={!saved || !wordsConfirmed || busy} testID="signup-confirm-create">
          <Text style={[styles.primaryBtnTxt, styles.pilotBtnTxt]}>{busy ? (it ? "Creazione…" : "Creating…") : (it ? "Crea account" : "Create account")}</Text>
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
              ? (it ? "Conserva le 12 parole e il file JSON cifrato con la sua frase segreta in un posto sicuro." : "Keep the 12 words and the encrypted JSON file with its passphrase somewhere safe.")
              : it
              ? "UNVOR genera la chiave privata sul telefono. Se perdi l’accesso al dispositivo, puoi rientrare con il file chiave cifrato e la sua frase segreta."
              : "UNVOR generates your private key on the phone. If you lose access to the device, use the encrypted keyfile and its passphrase to sign in again."}
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
        <TouchableOpacity style={[styles.primaryBtn, (busy || (RATCHET_PILOT && (!saved || !wordsConfirmed))) && styles.btnDim]} onPress={() => {
          if (saved || RATCHET_PILOT) { enter(); return; }
          Alert.alert(it ? "Continuare senza copia?" : "Continue without a copy?",
            it ? "Se perdi il telefono prima di esportare la chiave da Impostazioni, puoi perdere l’accesso all’account." : "If you lose the phone before exporting the key in Settings, you can lose access to the account.",
            [{ text: it ? "Annulla" : "Cancel", style: "cancel" },
              { text: it ? "Continua" : "Continue", onPress: enter }]);
        }} disabled={busy || (RATCHET_PILOT && (!saved || !wordsConfirmed))} testID="signup-enter">
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnTxt}>{it ? "Entra in UNVOR" : "Enter UNVOR"}</Text>}
        </TouchableOpacity>
        {!RATCHET_PILOT && <TouchableOpacity style={styles.back} disabled={busy} onPress={() => setShowKeyExport(true)} testID="signup-save-keyfile">
          <Text style={styles.backTxt}>{it ? "Salva una copia cifrata" : "Save an encrypted copy"}</Text>
        </TouchableOpacity>}
        {showKeyExport && <KeyfileExport keyfile={created.keyfile} english={!it}
          onClose={() => setShowKeyExport(false)} onShared={() => { setSaved(true); setShowKeyExport(false); }} />}
        {!RATCHET_PILOT && !saved && <Text style={styles.hintCenter}>{it ? "Puoi salvare il file chiave anche dopo, dalle Impostazioni." : "You can save the keyfile later in Settings."}</Text>}

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
        <Text style={styles.hint}>{server === DEFAULT_SERVER ? "Gateway UNVOR" : server}</Text>
        {signupUnavailable && <Text accessibilityLiveRegion="polite" style={styles.err}>
          {it ? "La registrazione non è disponibile su questo server. Puoi riprovare dopo l’aggiornamento del server o tornare all’accesso e scegliere un altro indirizzo."
            : "Registration is unavailable on this server. Try again after the server update, or go back to sign-in and choose another address."}
        </Text>}
        <Text style={styles.sub}>
          {it ? "Scegli un nome utente: sarà il tuo indirizzo UNVOR. Le chiavi vengono generate su questo dispositivo."
              : "Pick a username: it becomes your UNVOR address. Keys are generated on this device."}
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
  flex: { flex: 1 },
  secondaryBtn: { minHeight: 48, justifyContent: "center", paddingHorizontal: 14, marginTop: 10,
    backgroundColor: theme.surface, borderColor: theme.border, borderWidth: 1, borderRadius: 12 },
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
  pilotBtnTxt: { color: theme.onAccent || "#04152A" },
  btnDim: { opacity: 0.45 },
  okBadge: { alignSelf: "center", width: 62, height: 62, borderRadius: 31, alignItems: "center", justifyContent: "center", backgroundColor: theme.surface, borderColor: theme.accent, borderWidth: 1, marginBottom: 18 },
  lnsBig: { color: theme.primary, fontSize: 18, fontWeight: "800", marginBottom: 4 },
});
