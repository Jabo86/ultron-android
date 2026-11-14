import React, { useState, useEffect, useCallback } from "react";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Alert, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../context/AuthContext";
import { theme } from "../theme";
import * as api from "../lib/api";
import * as lock from "../lib/lock";
import PinStrength from "../components/PinStrength";
import { useI18n } from "../lib/i18n";
import * as devices from "../lib/devices";
import * as mbx from "../lib/mailbox";

const Card = ({ children }) => <View style={styles.card}>{children}</View>;

export default function PrivacyLockScreen({ navigation }) {
  const { lang } = useI18n();
  const en = lang === "en";
  const { user, decoySession } = useAuth();
  const [pinOn, setPinOn] = useState(false);
  const [devs, setDevs] = useState(null);
  const [myDev, setMyDev] = useState("");
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState(null); // "set" | "off"
  const [pin, setPin] = useState("");
  const [pin2, setPin2] = useState("");
  const [esca, setEsca] = useState("");
  const [err, setErr] = useState("");
  const [remoteReady, setRemoteReady] = useState(false);
  const [mbxSt, setMbxSt] = useState(null);

  const refresh = useCallback(async () => {
    setPinOn(await lock.hasPin());
    const target = decoySession ? null : await lock.resetTarget().catch(() => null);
    setRemoteReady(!!target?.armed && target.owner === user?.lns && target.server === user?.server);
    setMyDev(await devices.deviceId());
    try { const r = await api.listDevices(); setDevs(Array.isArray(r?.devices) ? r.devices : []); } catch { setDevs([]); }
    try { setMbxSt(await mbx.status()); } catch { setMbxSt(null); }
  }, [user, decoySession]);
  useEffect(() => { refresh(); }, [refresh]);

  const savePin = async () => {
    setErr("");
    if (pin !== pin2) { setErr("I due PIN non coincidono."); return; }
    setBusy(true);
    try {
      await lock.setupPin(pin);
      if (!decoySession && user) await lock.armReset(user.lns, user.server, api.panicArm).catch(() => false);
      if (esca) await lock.activateDecoy(pin, esca);
      setForm(null); setPin(""); setPin2(""); setEsca("");
      await refresh();
      Alert.alert("PIN attivo", "Dopo cinque PIN di sblocco errati consecutivi, Android ripristina ULTRON. In questa schermata puoi verificare lo stato della cancellazione sul gateway.");
    } catch (e) { setErr(String(e?.message || e)); }
    finally { setBusy(false); }
  };

  const removePin = async () => {
    setErr("");
    setBusy(true);
    try {
      await lock.disablePin(pin);
      setForm(null); setPin("");
      await refresh();
    } catch (e) { setErr(String(e?.message || e)); }
    finally { setBusy(false); }
  };

  const revoke = (d) => {
    Alert.alert("Disconnetti dispositivo", `${d.label || d.device_id} non riceverà più messaggi cifrati per lui. Continuare?`, [
      { text: "Annulla", style: "cancel" },
      { text: "Disconnetti", style: "destructive", onPress: async () => { try { await api.revokeDevice(d.device_id); await refresh(); } catch (e) { Alert.alert("Errore", api.apiErr(e)); } } },
    ]);
  };

  return (
    <View style={styles.root} testID="privacy-lock-screen">
      <View style={styles.head}>
        <TouchableOpacity onPress={() => navigation.goBack()} testID="privacylock-back"><Ionicons name="arrow-back-outline" size={24} color={theme.text} /></TouchableOpacity>
        <Text style={styles.headTitle}>Blocco e autodistruzione</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60 }}>
        <Card>
          <Text style={styles.h2}>PIN dell'app e cifratura locale</Text>
          <Text style={styles.p}>
            Con il PIN attivo, il file chiave e le chiavi di sessione vengono cifrati sul telefono (AES-256):
            a telefono bloccato o spento non sono leggibili nemmeno estraendo la memoria dell'app.
          </Text>
          <View style={styles.rowBetween}>
            <Text style={[styles.state, { color: pinOn ? theme.accent : theme.textDim }]} testID="pin-state">
              {pinOn ? "ATTIVO" : "NON ATTIVO"}
            </Text>
            <TouchableOpacity style={styles.btn} onPress={() => { setForm(pinOn ? "off" : "set"); setErr(""); }} testID="pin-toggle-btn">
              <Text style={styles.btnTxt}>{pinOn ? "Disattiva / cambia" : "Imposta PIN"}</Text>
            </TouchableOpacity>
          </View>
          {form === "set" && (
            <View style={{ marginTop: 12 }}>
              <View style={styles.warnBox} testID="pin-backup-warning">
                <Text style={styles.warnBoxTxt}>
                  Prima di attivare il PIN: tieni una copia del tuo file chiave in un posto sicuro
                  (fuori dal telefono). Se dimentichi il PIN non esiste recupero, e cinque PIN errati
                  avviano la cancellazione dei dati locali.
                </Text>
              </View>
              <TextInput style={styles.input} placeholder="PIN (4-10 cifre)" placeholderTextColor={theme.textFaint} keyboardType="number-pad" secureTextEntry value={pin} onChangeText={setPin} testID="pin-input" />
              <TextInput style={styles.input} placeholder="Ripeti il PIN" placeholderTextColor={theme.textFaint} keyboardType="number-pad" secureTextEntry value={pin2} onChangeText={setPin2} testID="pin-input-2" />
              <PinStrength pin={pin} />
              <Text style={styles.hint}>Usa un PIN lungo e difficile da indovinare. La protezione hardware dipende dal dispositivo e dal metodo di derivazione attivo.</Text>
              <TextInput style={styles.input} placeholder="PIN esca — doppio fondo (opzionale)" placeholderTextColor={theme.textFaint} keyboardType="number-pad" secureTextEntry value={esca} onChangeText={setEsca} testID="decoy-pin-input" />
              <Text style={styles.hint}>
                Il PIN esca apre un SECONDO profilo, separato: un altro account, altre chat,
                altri contatti. Se qualcuno ti costringe a sbloccare, apri quello: l'app
                funziona, e' viva, e del profilo vero non c'e' traccia. Nel telefono non
                viene salvato nessun verificatore del PIN esca, quindi non esiste un dato
                che provi che un secondo profilo esista.{"\n\n"}
                Due avvertenze, perche' contano piu della funzione: un'esca CREDIBILE va
                usata davvero, ogni tanto, altrimenti un profilo vuoto e appena creato dice
                da solo che stai nascondendo qualcosa. E la negazione plausibile difende da
                chi ti chiede di sbloccare il telefono, non da un'analisi forense fatta da
                chi conosce come e' costruita questa app.
              </Text>
              {!!err && <Text style={styles.err}>{err}</Text>}
              <TouchableOpacity style={[styles.btnFull, busy && { opacity: 0.6 }]} disabled={busy || pin.length < 4} onPress={savePin} testID="pin-save-btn">
                {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnTxt}>Salva PIN</Text>}
              </TouchableOpacity>
            </View>
          )}
          {form === "off" && (
            <View style={{ marginTop: 12 }}>
              <TextInput style={styles.input} placeholder="PIN attuale" placeholderTextColor={theme.textFaint} keyboardType="number-pad" secureTextEntry value={pin} onChangeText={setPin} testID="pin-current-input" />
              {!!err && <Text style={styles.err}>{err}</Text>}
              <TouchableOpacity style={[styles.btnFull, busy && { opacity: 0.6 }]} disabled={busy} onPress={removePin} testID="pin-remove-btn">
                {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnTxt}>Disattiva PIN</Text>}
              </TouchableOpacity>
              <TouchableOpacity style={{ marginTop: 12 }} onPress={() => { setForm("set"); setPin(""); setErr(""); }} testID="pin-change-btn">
                <Text style={styles.link}>Voglio solo cambiare il PIN →</Text>
              </TouchableOpacity>
            </View>
          )}
        </Card>

        <Card>
          <Text style={styles.h2}>Chiavi che si rinnovano (forward secrecy)</Text>
          <Text style={styles.p}>
            Ogni tuo dispositivo pubblica un lotto di chiavi usa-e-getta: chi ti scrive ne consuma una e
            viene buttata. Chi rubasse la tua chiave d'identità non può più decifrare i messaggi passati.
          </Text>
          <Text style={styles.mono} testID="my-device-id">Questo dispositivo: {myDev}</Text>
          {devs === null ? <ActivityIndicator color={theme.primary} style={{ marginTop: 10 }} /> : devs.length === 0 ? (
            <Text style={styles.hint}>Nessun dispositivo registrato (le chiavi verranno pubblicate al prossimo avvio).</Text>
          ) : devs.map((d) => (
            <View key={d.device_id} style={styles.devRow} testID={`device-${d.device_id}`}>
              <View style={{ flex: 1 }}>
                <Text style={styles.devName}>{d.label || d.device_id}{d.device_id === myDev ? "  ·  questo" : ""}</Text>
                <Text style={styles.devSub}>chiavi disponibili: {d.prekeys_left} · ultimo accesso: {(d.last_seen || "").slice(0, 16).replace("T", " ")}</Text>
              </View>
              {d.device_id !== myDev && (
                <TouchableOpacity onPress={() => revoke(d)} testID={`device-revoke-${d.device_id}`}>
                  <Ionicons name="close-circle-outline" size={22} color={theme.danger} />
                </TouchableOpacity>
              )}
            </View>
          ))}
        </Card>

        <Card>
          <Text style={styles.h2}>Cassetta anonima (sperimentale)</Text>
          <Text style={styles.p}>
            Con questa modalità i messaggi non vengono più inviati con il tuo account: vengono
            depositati in una cassetta dall'indirizzo casuale usando gettoni monouso che il tuo
            contatto ti ha consegnato nella chat cifrata. Serve un gateway compatibile e l’attivazione su entrambi i telefoni. Il gestore può osservare i metadati di rete.
          </Text>
          <View style={styles.rowBetween}>
            <Text style={[styles.state, { color: mbxSt && mbxSt.on ? theme.accent : theme.textDim }]} testID="mbx-state">
              {mbxSt && mbxSt.on ? "ATTIVA" : "NON ATTIVA"}
            </Text>
            <TouchableOpacity style={styles.btn} disabled={busy} testID="mbx-toggle-btn"
              onPress={async () => {
                setBusy(true);
                try { await mbx.setOn(!(mbxSt && mbxSt.on)); await refresh(); }
                catch (e) { Alert.alert("Errore", String(e?.message || e)); }
                finally { setBusy(false); }
              }}>
              <Text style={styles.btnTxt}>{mbxSt && mbxSt.on ? "Disattiva" : "Attiva"}</Text>
            </TouchableOpacity>
          </View>
          {!!(mbxSt && mbxSt.on) && (
            <Text style={styles.mono} testID="mbx-info">
              cassetta: {mbxSt.mailbox || "—"}{"\n"}gettoni miei disponibili: {mbxSt.tickets} · contatti pronti: {mbxSt.peers} · gettoni ricevuti: {mbxSt.peer_tickets}
            </Text>
          )}
        </Card>

        <Card>
          <Text style={[styles.h2, { color: theme.danger }]}>Autodistruzione</Text>
          <Text style={styles.p}>
            Dopo cinque PIN di sblocco errati consecutivi, Android cancella i dati di ULTRON e lascia l’app installata. Un PIN corretto azzera il contatore. Il debug USB e gli avvisi di integrità non causano un reset.
          </Text>
          <Text style={styles.hint}>
            {remoteReady ? "Cancellazione sul gateway registrata per questo account." : "Cancellazione sul gateway non confermata per questo account."}
          </Text>
          <Text style={styles.hint}>
            Il reset locale parte anche offline. Per cancellare l’account sul gateway deve arrivare la richiesta HTTPS. Il nome resta riservato dopo la cancellazione. Le copie esportate, i backup esistenti e le copie già sui telefoni dei destinatari restano fuori dal reset.
          </Text>
        </Card>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "transparent" },
  head: { flexDirection: "row", alignItems: "center", gap: 14, padding: 16, paddingTop: 52, backgroundColor: theme.surface },
  headTitle: { color: theme.text, fontSize: 18, fontWeight: "800" },
  card: { backgroundColor: theme.surface, borderRadius: 16, padding: 16, marginBottom: 14 },
  h2: { color: theme.text, fontSize: 15.5, fontWeight: "800", marginBottom: 6 },
  p: { color: theme.textDim, fontSize: 13.5, lineHeight: 20 },
  hint: { color: theme.textFaint, fontSize: 12, lineHeight: 17, marginTop: 8 },
  mono: { color: theme.textDim, fontSize: 12, marginTop: 10, fontFamily: "monospace" },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 14 },
  state: { fontSize: 12, fontWeight: "900", letterSpacing: 1 },
  btn: { backgroundColor: theme.primary, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 16 },
  btnFull: { backgroundColor: theme.primary, borderRadius: 12, paddingVertical: 13, alignItems: "center", marginTop: 12 },
  btnTxt: { color: "#fff", fontSize: 14.5, fontWeight: "800" },
  input: { backgroundColor: "transparent", color: theme.text, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 10, fontSize: 15 },
  err: { color: theme.danger, fontSize: 12.5, fontWeight: "700", marginTop: 4 },
  warnBox: { backgroundColor: "rgba(245,158,11,0.12)", borderColor: "rgba(245,158,11,0.45)", borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 12 },
  warnBoxTxt: { color: "#fcd9a0", fontSize: 12.5, lineHeight: 18 },
  link: { color: theme.primary, fontSize: 13, fontWeight: "700" },
  devRow: { flexDirection: "row", alignItems: "center", paddingVertical: 11, borderTopWidth: 1, borderTopColor: theme.border, marginTop: 8 },
  devName: { color: theme.text, fontSize: 14, fontWeight: "700" },
  devSub: { color: theme.textFaint, fontSize: 11.5, marginTop: 2 },
});
