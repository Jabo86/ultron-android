import { isOwner as canaryIsOwner } from "../lib/canary";
import React, { useState, useEffect, useMemo } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Switch, ActivityIndicator, Alert, Linking, Platform, Modal, TextInput, Share,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as appearance from "../lib/appearance";
import { Ionicons } from "@expo/vector-icons";
import Constants from "expo-constants";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import * as Print from "expo-print";
import { Asset } from "expo-asset";
import { useTint } from "../lib/appearance";
import { theme } from "../theme";
import { useI18n } from "../lib/i18n";
import { display as displayInfo, fpsLine } from "../lib/display";
import { useAuth } from "../context/AuthContext";
import { installUpdate, updatesConfigured } from "../lib/update";
import { checkAndPrepare } from "../components/UpdateBanner";
import { suppressLock } from "../lib/lockGuard";
import * as wake from "../lib/wake";
import * as api from "../lib/api";
import { DEFAULT_SERVER } from "../config";
import { isDeviceSecure, authenticate } from "../lib/biometrics";
import { registerForPush, scheduleDailyQuizReminder, loadReminderTimes } from "../lib/notifications";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as cover from "../lib/cover";
import { ICE_SERVERS } from "../config";
import { threatListSize } from "../lib/threatEngine";
import * as tunnel from "../lib/tunnel";
import * as meshNode from "../lib/mesh";
import MeshConstellation from "../components/MeshConstellation";
import { UI_LANGS } from "../lib/locales";
import * as meshRuntime from "../lib/mesh/runtime";
import * as meshRadio from "../lib/mesh/radio";
import * as meshChat from "../lib/meshchat";
import * as decdiag from "../lib/decdiag";
import { saveAllowDirect, loadAllowDirect, saveAppLock, loadAppLock, loadPreferredServer, savePreferredServer, loadKeyfile, saveAutoTranslate, loadAutoTranslate, saveTranslateTarget, loadTranslateTarget } from "../lib/store";
import { TRANSLATE_LANGS, langName } from "../lib/langs";
import { getThreatLog, clearThreatLog, getThreatCount } from "../lib/threatLog";

const PRIVACY_LNS = "";
const HAS_TURN = ICE_SERVERS.some(({ urls }) => [urls].flat().some((url) => /^turns?:/i.test(url)));

const LEGAL_DOCS = [
  { key: "settings.privacy", path: "/privacy", icon: "shield-checkmark-outline" },
  { key: "settings.terms", path: "/termini", icon: "document-text-outline" },
  { key: "settings.cookie", path: "/cookie", icon: "cafe-outline" },
  { key: "settings.dpa", path: "/dpa", icon: "server-outline" },
  { key: "settings.eula", path: "/licenza", icon: "ribbon-outline" },
  { key: "settings.aup", path: "/uso-accettabile", icon: "checkmark-done-outline" },
  { key: "settings.sla", path: "/sla", icon: "speedometer-outline" },
  { key: "settings.legalIndex", path: "/legale", icon: "library-outline" },
];

function fmtAgo(ts, lang, t) {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  const en = lang === "en";
  if (s < 60) return t("sm.001");
  const m = Math.floor(s / 60); if (m < 60) return t("sm.ago.min", { n: m });
  const h = Math.floor(m / 60); if (h < 24) return t("sm.ago.hour", { n: h });
  const d = Math.floor(h / 24); if (d < 7) return t("sm.ago.day", { n: d });
  try { return new Date(ts).toLocaleDateString(); } catch { return ""; }
}

const LEGAL_IT = `PRIVACY E REGOLE DELLE AREE PUBBLICHE

I dettagli privati del profilo restano cifrati sul telefono. Pubblicando foto, informazioni o bio li rendi leggibili al server e agli utenti che accedono al profilo. Chi li vede può conservarne una copia.

Il server gestisce identità e chiavi pubbliche, richieste, metadati di servizio, buste cifrate dove supportate e contenuti pubblicati. Il codice del gateway registra accessi con identità, orario e identificatore di sessione. Proxy, hosting e server personali possono avere log e tempi di conservazione diversi.

Le chiavi private e il PIN non sono inclusi nelle richieste di autenticazione. Le esportazioni esplicite del file chiave e i backup sono sotto il controllo dell’utente. Se attivi traduzione, la funzione può inviare il testo selezionato al servizio. Le segnalazioni e le tracce diagnostiche possono inviare informazioni al gestore.

Nelle aree pubbliche pubblica solo materiale che puoi condividere. Evita dati personali altrui, molestie, spam, truffe e file malevoli. Usa le funzioni di blocco e segnalazione dove disponibili. Consulta le regole, la conservazione e i recapiti pubblicati dal gestore del tuo server.`;

const LEGAL_EN = `PRIVACY AND PUBLIC-AREA RULES

Private profile details are encrypted on the phone. Publishing a photo, about text or bio makes it readable to the server and users who view the profile. Viewers can keep copies.

The server processes identities and public keys, requests, service metadata, encrypted envelopes where supported, and published content. Gateway code logs sign-ins with identity, time and session ID. Proxies, hosting providers and personal servers can have different logging and retention practices.

Authentication requests omit private keys and the PIN. Explicit key-file exports and backups are under the user's control. Translation can send selected text to the service when enabled. Reports and diagnostic traces can send information to the operator.

Publish only material you can share. Avoid other people's private information, harassment, spam, scams and malicious files. Use blocking and reporting where available. Consult the rules, retention and contacts published by your server operator.`;

function radioLabel(v, t) {
  const k = String(v || "off");
  const known = ["off", "perm", "on", "group", "bt-off", "adv+scan", "near"];
  return known.includes(k) ? t("sm.radio." + k) : k;
}

export default function SettingsScreen({ navigation }) {
  const tint = useTint();
  const styles = useMemo(() => makeStyles(tint), [tint]);
  const { t, lang, setLang } = useI18n();
  const [fps, setFps] = useState({ hz: 0, maxHz: 0, modes: 0 });
  const en = lang === "en";
  const { user, signOut, lock } = useAuth();
  const isOss = (user?.lns || "").endsWith("@tuttooss.lns");
  const isOwner = canaryIsOwner(user);
  const [callDirect, setCallDirect] = useState(false);
  const [chaff, setChaff] = useState(true);
  const [darkMesh, setDarkMesh] = useState(false);
  const [meshBusy, setMeshBusy] = useState(false);
  const [sovereign, setSovereign] = useState(false);
  const [netHealth, setNetHealth] = useState(null);
  const [sovBusy, setSovBusy] = useState(false);
  const [probeCode, setProbeCode] = useState("");
  const [meshQ, setMeshQ] = useState(null);
  const [relayCode, setRelayCode] = useState("");
  const [testBusy, setTestBusy] = useState(false);
  const [wakeOn, setWakeOn] = useState(false);
  const [wakeBusy, setWakeBusy] = useState(false);
  const [upBusy, setUpBusy] = useState(false);
  const [upMsg, setUpMsg] = useState("");
  // Controllo manuale: se c'è una versione più nuova la scarica e apre l'installazione
  // in sovrascrittura (nessuna disinstallazione).
  const doCheckUpdate = async () => {
    setUpBusy(true); setUpMsg("");
    try {
      if (!updatesConfigured) {
        setUpMsg(en ? "Updates require the official release signature." : "Gli aggiornamenti richiedono la firma di rilascio ufficiale.");
        return;
      }
      const release = await checkAndPrepare({ force: true });
      if (!release) {
        setUpMsg(en ? "No update available." : "Nessun aggiornamento disponibile.");
        return;
      }
      suppressLock();
      await installUpdate(release.file);
      setUpMsg(t("sm.006"));
    } catch (e) {
      setUpMsg(String((e && e.message) || (t("sm.007"))));
    } finally { setUpBusy(false); }
  };
  const shareCard = async () => {
    const me = (user?.lns || "").toLowerCase();
    const url = `${api.getServerUrl()}/card.html?u=${encodeURIComponent(me)}`;
    try {
      await Share.share({ message: (t("sm.008")) + url });
    } catch { /* annullato */ }
  };
  const inviteFriend = async () => {
    const me = (user?.lns || "").toLowerCase();
    const url = `${api.getServerUrl()}/signup.html?ref=${encodeURIComponent(me)}`;
    try {
      await Share.share({ message: (t("sm.009")) + url });
    } catch { /* utente ha annullato */ }
  };
  const insets = useSafeAreaInsets();
  const [secure, setSecure] = useState(false);
  const [appLock, setAppLock] = useState(true);
  const [pushOk, setPushOk] = useState(null);
  const [pushBusy, setPushBusy] = useState(false);
  const [autoTr, setAutoTr] = useState(false);
  const [trTarget, setTrTarget] = useState(null);
  const [showTrLang, setShowTrLang] = useState(false);
  const [trSearch, setTrSearch] = useState("");
  const [threatLog, setThreatLog] = useState([]);
  const [threatCount, setThreatCount] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showLegal, setShowLegal] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [delText, setDelText] = useState("");
  const [genPdf, setGenPdf] = useState(false);
  const [reminderTimes, setReminderTimes] = useState([{ hour: 19, minute: 0 }]);
  const [pickHour, setPickHour] = useState(19);
  const [pickMinute, setPickMinute] = useState(0);
  useEffect(() => { displayInfo().then(setFps).catch(() => {}); }, []);

  useEffect(() => { loadAllowDirect().then((v) => setCallDirect(!!v)).catch(() => {}); }, []);

  // Notifiche dal nostro server: il servizio nativo tiene aperta una connessione in attesa
  // usando soltanto il servizio nativo e il nodo ULTRON.
  const toggleWake = async (v) => {
    setWakeBusy(true);
    try {
      if (v) {
        if (!(await registerForPush())) throw new Error(en ? "Allow notifications in Android settings." : "Consenti le notifiche nelle impostazioni Android.");
        await wake.enable();
        setWakeOn(true);
        Alert.alert(
          t("sm.010"),
          t("sm.011")
        );
      } else {
        await wake.disable();
        setWakeOn(false);
      }
    } catch (e) {
      Alert.alert(t("sm.012"), String((e && e.message) || e));
    } finally { setWakeBusy(false); await checkPush(); }
  };

  useEffect(() => { loadReminderTimes().then((ts) => { if (ts?.length) setReminderTimes(ts); }).catch(() => {}); }, []);
  const persistTimes = async (arr) => {
    const norm = arr
      .map((t) => ({ hour: t.hour | 0, minute: t.minute | 0 }))
      .filter((t, i, a) => a.findIndex((x) => x.hour === t.hour && x.minute === t.minute) === i)
      .sort((a, b) => (a.hour * 60 + a.minute) - (b.hour * 60 + b.minute));
    setReminderTimes(norm);
    try { await AsyncStorage.setItem("reminder_times", JSON.stringify(norm)); await scheduleDailyQuizReminder(norm); } catch { /* */ }
  };
  const addTime = () => persistTimes([...reminderTimes, { hour: pickHour, minute: pickMinute }]);
  const removeTime = (t) => persistTimes(reminderTimes.filter((x) => !(x.hour === t.hour && x.minute === t.minute)));

  const base = user?.server || DEFAULT_SERVER;
  const [showServer, setShowServer] = useState(false);
  const [server, setServer] = useState(base);
  const [serverBusy, setServerBusy] = useState(false);
  const [serverMessage, setServerMessage] = useState("");
  const [keyBusy, setKeyBusy] = useState(false);

  useEffect(() => {
    loadPreferredServer().then((value) => setServer(value || base)).catch(() => {});
  }, [base]);

  const saveNextServer = async () => {
    setServerBusy(true);
    setServerMessage("");
    try {
      const target = await api.verifyServer(server);
      await savePreferredServer(target);
      setServer(target);
      setServerMessage(en
        ? "Server verified and saved for the next sign-in or registration. Save your key file before signing out."
        : "Server verificato e salvato per il prossimo accesso o registrazione. Salva il file chiave prima di uscire.");
    } catch {
      setServerMessage(en
        ? "Check the HTTPS address and confirm the ULTRON server is online."
        : "Controlla l’indirizzo HTTPS e verifica che il server ULTRON sia online.");
    } finally { setServerBusy(false); }
  };

  const exportKey = async () => {
    let uri;
    setKeyBusy(true);
    try {
      if (!(await authenticate(en ? "Authorize key file export" : "Autorizza la copia del file chiave"))) return;
      const keyfile = await loadKeyfile();
      if (!keyfile || !(await Sharing.isAvailableAsync())) throw new Error();
      uri = FileSystem.cacheDirectory + "ultron-account-key.json";
      await FileSystem.writeAsStringAsync(uri, JSON.stringify(keyfile));
      suppressLock();
      await Sharing.shareAsync(uri, { mimeType: "application/json" });
    } catch {
      Alert.alert(en ? "Key file" : "File chiave", en ? "Export unavailable." : "Copia non disponibile.");
    } finally {
      if (uri) await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
      setKeyBusy(false);
    }
  };

  useEffect(() => {
    (async () => {
      setSecure(await isDeviceSecure());
      const al = await loadAppLock(); setAppLock(al !== false);
      setAutoTr(await loadAutoTranslate());
      setTrTarget(await loadTranslateTarget());
    })();
  }, []);

  useEffect(() => {
    const load = () => {
      getThreatLog().then((l) => setThreatLog(l.slice()));
      getThreatCount().then(setThreatCount);
    };
    load();
    const unsub = navigation.addListener("focus", load);
    return unsub;
  }, [navigation]);

  const emptyThreatLog = async () => { await clearThreatLog(); setThreatLog([]); };

  // Minacce bloccate negli ultimi 7 giorni (dal registro locale), per il grafico.
  const weekBars = useMemo(() => {
    const days = [];
    const now = new Date();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - i);
      days.push({ start: d.getTime(), end: d.getTime() + 86400000, n: 0, label: d.toLocaleDateString(lang === "en" ? "en-GB" : "it-IT", { weekday: "short" }).slice(0, 2) });
    }
    for (const e of threatLog) {
      for (const day of days) { if (e.at >= day.start && e.at < day.end) { day.n++; break; } }
    }
    return days;
  }, [threatLog, lang]);
  const weekMax = Math.max(1, ...weekBars.map((d) => d.n));

  const toggleLock = async (v) => {
    if (v && !secure) { Alert.alert(t("settings.appLock"), t("settings.appLock.noHw")); return; }
    if (v) { const ok = await authenticate(); if (!ok) return; }
    setAppLock(v); await saveAppLock(v);
  };
  // PROVA FISICA: l'unica che vale. Il pacchetto passa dal mezzo reale (UDP sulla Wi-Fi).
  const runProbe = async () => {
    if (testBusy) return;
    setTestBusy(true);
    try { setProbeCode(await meshRuntime.sendProbe()); }
    catch (e) { Alert.alert(t("sm.013"), String((e && e.message) || e)); }
    finally { setTestBusy(false); }
  };
  const runRelay = async () => {
    if (testBusy) return;
    setTestBusy(true);
    try { setRelayCode(await meshRuntime.startSelfTest()); }
    catch (e) { Alert.alert(t("sm.013"), String((e && e.message) || e)); }
    finally { setTestBusy(false); }
  };
  const chooseSovereign = async (v) => {
    if (sovBusy || v === sovereign) return;
    setSovBusy(true);
    try {
      if (v) {
        // FASE 2: senza questi permessi Android non consente Wi-Fi Direct né BLE.
        if (!(await meshRadio.has())) {
          Alert.alert(t("sm.014"),
            t("sm.015"));
          try { await meshRadio.request(); } catch { /* si procede: la mesh Wi-Fi funziona comunque */ }
        }
        await meshRuntime.start(user, meshChat.onDeliver, () => meshChat.flush(user), require("../lib/bridge").carry);
        setSovereign(true);
        Alert.alert(t("sm.016"),
          t("sm.017"));
      } else {
        await meshRuntime.stop();
        setSovereign(false);
      }
    } catch (e) {
      setSovereign(false);
      Alert.alert(t("sm.018"), String((e && e.message) || e));
    } finally { setSovBusy(false); }
  };
  const toggleMesh = async (v) => {
    if (meshBusy) return;
    setMeshBusy(true);
    try {
      await tunnel.setEnabled(v);
      setDarkMesh(v);
      if (v) Alert.alert(t("sm.021"),
        t("sm.022"));
    } catch (e) {
      setDarkMesh(false);
      Alert.alert(t("sm.023"),
        t("sm.024"));
    } finally { setMeshBusy(false); }
  };
  const checkPush = async (askPermission = false) => {
    setPushBusy(true);
    try {
      const active = await wake.isOn();
      const allowed = await registerForPush({ askPermission });
      setWakeOn(active);
      setPushOk(allowed && active);
    } catch { setPushOk(false); }
    finally { setPushBusy(false); }
  };
  useEffect(() => {
    const refresh = () => { checkPush(); };
    refresh();
    return navigation.addListener("focus", refresh);
  }, [navigation]);
  useEffect(() => { cover.isEnabled().then(setChaff).catch(() => {}); }, []);
  useEffect(() => { tunnel.isEnabled().then(setDarkMesh).catch(() => {}); }, []);
  useEffect(() => { meshNode.getMode().then((m) => setSovereign(m === meshNode.SOVEREIGN)).catch(() => {}); }, []);
  // Barometro: si aggiorna solo mentre la modalità è attiva (nessun consumo altrimenti).
  useEffect(() => {
    if (!sovereign) { setNetHealth(null); return undefined; }
    let alive = true;
    const tick = () => {
      meshRuntime.status().then((st) => { if (alive) setNetHealth(st); }).catch(() => {});
      meshChat.status().then((s) => { if (alive) setMeshQ(s); }).catch(() => {});
    };
    tick();
    const iv = setInterval(tick, 5000);
    return () => { alive = false; clearInterval(iv); };
  }, [sovereign]);

  const doExport = async () => {
    setExporting(true);
    try {
      const data = await api.accountExport();
      const path = FileSystem.cacheDirectory + `ultron-dati-${Date.now()}.json`;
      await FileSystem.writeAsStringAsync(path, JSON.stringify(data, null, 2), { encoding: FileSystem.EncodingType.UTF8 });
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(path, { mimeType: "application/json", dialogTitle: t("settings.export") });
      else Alert.alert(t("settings.export"), t("settings.export.done"));
    } catch (e) { Alert.alert(t("settings.export"), api.apiErr(e)); }
    finally { setExporting(false); }
  };

  const doDelete = () => { setDelText(""); setShowDelete(true); };
  const confirmDelete = async () => {
    setDeleting(true);
    try { await api.accountDelete(); setShowDelete(false); Alert.alert(t("settings.delete"), t("settings.delete.done")); await signOut(); }
    catch (e) { Alert.alert(t("settings.delete"), api.apiErr(e)); }
    finally { setDeleting(false); }
  };

  const openLegal = (doc) => navigation.navigate("Legal", { url: base + doc.path, title: t(doc.key) });

  const doCompliance = async () => {
    setGenPdf(true);
    try {
      const it = lang !== "en";
      const now = new Date().toLocaleString(it ? "it-IT" : "en-US");
      const d = new Date();
      const protocol = `ULTRON-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}-${Math.random().toString(16).slice(2, 8).toUpperCase()}`;
      let logo = "";
      try {
        const asset = Asset.fromModule(require("../../assets/ultron-logo.png"));
        await asset.downloadAsync();
        if (asset.localUri) {
          const b64 = await FileSystem.readAsStringAsync(asset.localUri, { encoding: FileSystem.EncodingType.Base64 });
          logo = `data:image/png;base64,${b64}`;
        }
      } catch {}
      const L = it
        ? { title: "Ricevuta informativa", sub: "Sicurezza e privacy · ULTRON",
            issued: "Generata il", proto: "Riferimento", subject: "Identità", controller: "Server configurato",
            secTitle: "Funzioni del client", privTitle: "Limiti e trattamento dati",
            sec: [
              "Il client include cifratura di buste e allegati e autenticazione a firma ML-DSA.",
              "Il backup viene cifrato sul telefono prima del salvataggio o della condivisione.",
              "La verifica dei contatti e i controlli locali sono accessibili nell’app.",
            ],
            priv: [
              "I dettagli pubblici del profilo sono leggibili dal server.",
              "Metadati, log e conservazione dipendono dal servizio e dal gestore.",
              "Lo stato delle funzioni e delle prove disponibili è riportato in Sicurezza e audit.",
            ],
            footer: "Documento informativo generato dall’app ULTRON. Non costituisce una certificazione di conformità." }
        : { title: "Informational receipt", sub: "Security and privacy · ULTRON",
            issued: "Generated", proto: "Reference", subject: "Identity", controller: "Configured server",
            secTitle: "Client features", privTitle: "Limits and data processing",
            sec: [
              "The client includes envelope and attachment encryption and ML-DSA authentication.",
              "Backups are encrypted on the phone before saving or sharing.",
              "Contact verification and local checks are available in the app.",
            ],
            priv: [
              "Public profile details are readable by the server.",
              "Metadata, logs and retention depend on the service and its operator.",
              "Security and audit describes feature status and available tests.",
            ],
            footer: "Informational document generated by ULTRON. It is not a compliance certification." };
      const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (c) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
      })[c]);
      const li = (arr) => arr.map((x) => `<li>${x}</li>`).join("");
      const html = `<html><head><meta charset="utf-8"><style>
        body{font-family:Georgia,serif;color:#111;padding:44px;max-width:720px;margin:auto}
        .hdr{display:flex;align-items:center;gap:14px;margin-bottom:6px}
        .hdr img{height:44px;width:auto}
        .brand{color:#50C878;font-size:12px;letter-spacing:2px;text-transform:uppercase}
        h1{font-size:24px;margin:6px 0 2px;border-bottom:3px solid #50C878;padding-bottom:10px}
        .sub{color:#555;font-size:13px;margin-bottom:20px}
        .meta{background:#f5f7fb;border:1px solid #e2e8f5;border-radius:8px;padding:14px 16px;font-size:13px;margin-bottom:22px}
        .meta b{color:#50C878}
        h2{font-size:15px;color:#0a2540;margin:22px 0 8px}
        ul{margin:0;padding-left:20px}li{font-size:13px;line-height:1.7}
        .badge{display:inline-block;background:#50C878;color:#063;border-radius:6px;padding:3px 9px;font-size:11px;font-weight:bold;letter-spacing:1px}
        .ft{margin-top:28px;font-size:11px;color:#888;border-top:1px solid #eee;padding-top:12px}
      </style></head><body>
        <div class="hdr">${logo ? `<img src="${logo}"/>` : ""}<div class="brand">ULTRON</div></div>
        <h1>${L.title}</h1>
        <div class="sub">${L.sub}</div>
        <div class="meta">
          <div><b>${L.proto}</b> ${protocol}</div>
          <div><b>${L.issued}:</b> ${now}</div>
          <div><b>${L.subject}:</b> ${escapeHtml(user?.lns || "—")}</div>
          <div><b>${L.controller}:</b> ${escapeHtml(base)}</div>
        </div>
        <h2>${L.secTitle}</h2><ul>${li(L.sec)}</ul>
        <h2>${L.privTitle}</h2><ul>${li(L.priv)}</ul>
        <div class="ft">${L.footer}</div>
      </body></html>`;
      const { uri } = await Print.printToFileAsync({ html });
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { mimeType: "application/pdf", dialogTitle: L.title });
    } catch (e) { Alert.alert(t("settings.compliance"), api.apiErr(e)); }
    finally { setGenPdf(false); }
  };

  const Row = ({ icon, label, hint, right, onPress, danger, testID }) => (
    <TouchableOpacity style={styles.row} onPress={onPress} disabled={!onPress} activeOpacity={onPress ? 0.6 : 1} testID={testID}>
      <Ionicons name={icon} size={20} color={danger ? theme.danger : tint} style={{ width: 26 }} />
      <View style={{ flex: 1 }}>
        <Text style={[styles.rowLabel, danger && { color: theme.danger }]}>{label}</Text>
        {hint ? <Text style={styles.rowHint}>{hint}</Text> : null}
      </View>
      {right}
    </TouchableOpacity>
  );

  const [memberPerm, setMemberPerm] = useState(null);
  useEffect(() => { api.membersPermissions().then(setMemberPerm).catch(() => setMemberPerm(null)); }, []);

  const [look, setLook] = useState(appearance.get());
  useEffect(() => { appearance.load().then((v) => setLook({ ...v })); }, []);

  return (
    <ScrollView style={styles.root} contentContainerStyle={{ paddingTop: insets.top + 14, paddingBottom: 60 }}>
      <Text style={styles.title}>{t("settings.title")}</Text>

      {/* ASPETTO DELLA CHAT — colore d'accento e sfondo, scelti dall'utente */}
      <Text style={styles.section}>{t("sm.025")}</Text>
      <View style={styles.card}>
        <View style={{ padding: 14 }}>
          <Text style={styles.lookLabel}>{t("sm.026")}</Text>
          <View style={styles.lookRow}>
            {appearance.ACCENTS.map((a) => (
              <TouchableOpacity
                key={a.id}
                onPress={() => appearance.set({ accent: a.id }).then((v) => setLook({ ...v }))}
                style={[styles.swatch, { backgroundColor: a.color }, look.accent === a.id && styles.swatchOn]}
                testID={"look-accent-" + a.id}
              >
                {look.accent === a.id ? <Ionicons name="checkmark-outline" size={16} color="#04070E" /> : null}
              </TouchableOpacity>
            ))}
          </View>
          <Text style={[styles.lookLabel, { marginTop: 18 }]}>{t("sm.027")}</Text>
          <View style={styles.lookRow}>
            {appearance.BACKGROUNDS.map((b) => (
              <TouchableOpacity
                key={b.id}
                onPress={() => appearance.set({ bg: b.id }).then((v) => setLook({ ...v }))}
                style={[styles.swatch, { backgroundColor: b.color, borderColor: "rgba(255,255,255,0.25)", borderWidth: 1 }, look.bg === b.id && styles.swatchOn]}
                testID={"look-bg-" + b.id}
              >
                {look.bg === b.id ? <Ionicons name="checkmark-outline" size={16} color="#fff" /> : null}
              </TouchableOpacity>
            ))}
          </View>
          <Text style={styles.lookHint}>
            {t("sm.028")}
          </Text>
        </View>
      </View>

      {/* ACCOUNT */}
      <View style={styles.card}>
        <Row icon="notifications-outline" label={t("sm.029")} hint={t("sm.030")} onPress={() => navigation.navigate("Notifications")} right={<Ionicons name="chevron-forward-outline" size={18} color={theme.textFaint} />} testID="settings-notifications" />
      </View>

      <Text style={styles.section}>{t("settings.section.account")}</Text>
      <View style={styles.card}>
        <Row icon="person-circle-outline" label={t("settings.profile")} hint={t("settings.profile.hint")} onPress={() => navigation.navigate("Profilo")}
          right={<Ionicons name="chevron-forward-outline" size={18} color={theme.textFaint} />} testID="settings-profile" />
        <View style={styles.divider} />
        <Row icon="finger-print" label={t("settings.identity")} hint={user?.lns} testID="settings-identity" />
        <View style={styles.divider} />
        <Row icon="server-outline" label={t("settings.server")} hint={base} testID="settings-server" />
        <View style={styles.divider} />
        <Row icon="link-outline" label={en ? "Connect a personal server" : "Collega un server personale"}
          onPress={() => setShowServer((value) => !value)} testID="settings-connect-server" />
        {showServer && <View style={{ padding: 14 }}>
          <Text style={styles.infoText}>{en
            ? "Enter the HTTPS address of your ULTRON server. Use a key file issued by that server or create an account if it supports registration."
            : "Inserisci l’indirizzo HTTPS del tuo server ULTRON. Usa un file chiave emesso da quel server o crea un account se la registrazione è disponibile."}</Text>
          <TextInput style={styles.serverInput} value={server} onChangeText={setServer} editable={!serverBusy}
            autoCapitalize="none" autoCorrect={false} keyboardType="url" placeholder="https://messaggi.example.org"
            placeholderTextColor={theme.textFaint} testID="settings-server-url" />
          <TouchableOpacity style={styles.updBtn} onPress={saveNextServer} disabled={serverBusy}
            testID="settings-server-save">
            <Text style={styles.updBtnTxt}>{serverBusy
              ? (en ? "Checking…" : "Verifica…")
              : (en ? "Verify and save" : "Verifica e salva")}</Text>
          </TouchableOpacity>
          {!!serverMessage && <Text accessibilityLiveRegion="polite" style={styles.infoText}>{serverMessage}</Text>}
        </View>}
        <View style={styles.divider} />
        <Row icon="key-outline" label={en ? "Export key file" : "Esporta file chiave"}
          onPress={keyBusy ? null : exportKey} testID="settings-export-key" />
      </View>

      {/* CONSOLE ADMIN (solo owner) */}
      {isOwner && (
        <>
          <Text style={styles.section}>Console Admin</Text>
          <View style={styles.card}>
            <Row icon="mail-unread-outline" label="Richieste ricevute" hint="Lead e richieste dal sito e dai contatti"
              onPress={() => navigation.navigate("Leads")}
              right={<Ionicons name="chevron-forward-outline" size={18} color={theme.textFaint} />} testID="settings-leads" />
            <Row icon="ribbon-outline" label="Licenze / Scadenze" hint="Aziende attive e licenze in scadenza"
              onPress={() => navigation.navigate("Licenses")}
              right={<Ionicons name="chevron-forward-outline" size={18} color={theme.textFaint} />} testID="settings-licenses" />
          </View>
        </>
      )}

      {/* GESTIONE MEMBRI (admin/owner del tenant) */}
      {memberPerm?.can_manage && (
        <>
          <Text style={styles.section}>{t("sm.113")}</Text>
          <View style={styles.card}>
            <Row icon="people-outline" label={t("sm.114")}
              hint={t("sm.115")}
              onPress={() => navigation.navigate("Members")}
              right={<Ionicons name="chevron-forward-outline" size={18} color={theme.textFaint} />} testID="settings-members" />
          </View>
        </>
      )}

      {/* FLUIDITA - v2.5.0. Non c'e' un interruttore da offrire: la frequenza dello
          schermo la decide il telefono. Qui si LEGGE quella concessa e si scrive senza
          abbellirla: 60 Hz dice 60, e se il sistema sta limitando i 120 Hz lo dice. */}
      <View style={styles.card}>
        <Row icon="speedometer-outline" label={t("sm.116")}
          hint={fpsLine(fps, lang !== "en")}
          right={<Text style={styles.langTxt} testID="settings-fps">{fps.hz ? Math.round(fps.hz) + " fps" : "\u2014"}</Text>}
          testID="settings-smoothness" />
      </View>

      {/* LANGUAGE */}
      <View style={styles.card}>
        <Row icon="language-outline" label={t("profile.language")} hint={t("settings.language.hint")} right={
          <Text style={styles.langTxt} testID="settings-lang-current">
            {(UI_LANGS.find((x) => x.code === lang) || UI_LANGS[0]).flag + "  " + (UI_LANGS.find((x) => x.code === lang) || UI_LANGS[0]).native}
          </Text>
        } />
        <View style={styles.langWrap}>
          {UI_LANGS.map((l) => (
            <TouchableOpacity key={l.code} style={[styles.langBtn, lang === l.code && styles.langBtnActive]} onPress={() => setLang(l.code)} testID={`settings-lang-${l.code}`}>
              <Text style={[styles.langTxt, lang === l.code && { color: "#fff" }]}>{l.flag + "  " + l.code.toUpperCase()}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <View style={styles.divider} />
        <Row icon="globe-outline" label={t("sm.117")}
          hint={t("sm.118")}
          right={<Switch value={autoTr} onValueChange={async (v) => { setAutoTr(v); await saveAutoTranslate(v); }} trackColor={{ true: tint, false: theme.border }} thumbColor="#fff" testID="settings-autotranslate" />} />
        <View style={styles.divider} />
        <Row icon="swap-horizontal-outline" label={t("sm.119")}
          hint={trTarget ? langName(trTarget) : (t("sm.120"))}
          onPress={() => { setTrSearch(""); setShowTrLang(true); }}
          right={<Ionicons name="chevron-forward-outline" size={18} color={theme.textFaint} />} testID="settings-translate-lang" />
      </View>

      {/* SECURITY */}
      <Text style={styles.section}>{t("settings.section.security")}</Text>
      <View style={styles.privStatus} testID="settings-privacy-status">
        {[
          { on: chaff, label: (en ? "Cover traffic requested" : "Rumore configurato"), tid: "privstat-noise" },
          { on: darkMesh, label: "Dark Mesh", tid: "privstat-mesh" },
          { on: !callDirect && HAS_TURN, label: HAS_TURN ? t("sm.032") : (en ? "TURN unavailable" : "TURN non configurato"), tid: "privstat-relay" },
          ...(sovereign ? [{ on: netHealth ? netHealth.key !== "isolated" : false, tid: "privstat-mesh-health",
            label: (t("sm.033")) + meshNode.healthLabel(netHealth ? netHealth.key : "isolated", en) }] : []),
        ].map((it) => (
          <View key={it.tid} style={styles.privPill} testID={it.tid}>
            <View style={[styles.privDot, { backgroundColor: it.on ? "#50C878" : theme.textFaint }]} />
            <Text style={[styles.privPillTxt, { color: it.on ? theme.text : theme.textFaint }]}>{it.label}</Text>
          </View>
        ))}
      </View>
      <View style={styles.card}>
        <Row icon="lock-closed-outline" label={t("settings.appLock")} hint={secure ? t("settings.appLock.hint") : t("settings.appLock.noHw")}
          right={<Switch value={appLock} onValueChange={toggleLock} trackColor={{ true: tint, false: theme.border }} thumbColor="#fff" testID="settings-applock" />} />
        <View style={styles.divider} />
        <Row icon="radio-outline"
          label={t("sm.034")}
          hint={wakeOn
            ? (t("sm.035"))
            : (t("sm.036"))}
          right={wakeBusy
            ? <ActivityIndicator color={tint} />
            : <Switch value={wakeOn} onValueChange={toggleWake} trackColor={{ true: tint, false: theme.border }} thumbColor="#fff" testID="settings-wake" />} />
        <View style={styles.divider} />
        <Row icon="git-network-outline"
          label={t("sm.037")}
          hint={callDirect ? t("sm.038") : HAS_TURN ? t("sm.039")
            : (en ? "Relay-only calls need a TURN server." : "Le chiamate solo relay richiedono un server TURN.")}
          right={<Switch value={callDirect} onValueChange={async (v) => { setCallDirect(v); await saveAllowDirect(v); }} trackColor={{ true: "#50C878", false: theme.border }} thumbColor="#fff" testID="settings-call-direct" />} />
        <View style={styles.divider} />
        <Row icon="pulse-outline"
          label={t("sm.040")}
          hint={en ? "Runs while Android keeps the service active. 24/7 operation is unverified."
            : "Funziona quando Android mantiene il servizio attivo. La continuità H24 è da verificare."}
          right={<Switch value={chaff} onValueChange={async (v) => { setChaff(v); await cover.setEnabled(v); }} trackColor={{ true: tint, false: theme.border }} thumbColor="#fff" testID="settings-chaff" />} />
        <View style={styles.divider} />
        <Row icon="eye-off-outline"
          label={t("sm.043")}
          hint={tunnel.available() ? (darkMesh ? t("sm.044") : t("sm.045"))
            : (en ? "No tunnel profile configured." : "Profilo del tunnel assente in questa build.")}
          right={meshBusy
            ? <ActivityIndicator color={tint} />
            : <Switch value={darkMesh} disabled={!tunnel.available()} onValueChange={toggleMesh} trackColor={{ true: tint, false: theme.border }} thumbColor="#fff" testID="settings-darkmesh" />} />
        <View style={styles.divider} />
        <View style={styles.modeBox} testID="mesh-mode">
          <Text style={styles.modeTitle}>{t("sm.046")}</Text>
          <Text style={styles.modeHint}>
            {en ? "Experimental mesh mode. The app can still contact the server or use a bridge." : "Modalità mesh sperimentale. L’app può ancora usare il server o un ponte."}
          </Text>
          <View style={styles.modeRow}>
            <TouchableOpacity
              style={[styles.modeBtn, !sovereign && { borderColor: tint, backgroundColor: tint + "1A" }]}
              onPress={() => chooseSovereign(false)}
              disabled={sovBusy}
              testID="mesh-mode-standard"
            >
              <Ionicons name="cloud-outline" size={17} color={!sovereign ? tint : theme.textDim} />
              <Text style={[styles.modeBtnTxt, !sovereign && { color: tint }]}>{t("sm.048")}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.modeBtn, sovereign && { borderColor: tint, backgroundColor: tint + "1A" }]}
              onPress={() => chooseSovereign(true)}
              disabled={sovBusy}
              testID="mesh-mode-sovereign"
            >
              {sovBusy ? <ActivityIndicator color={tint} /> : <Ionicons name="git-network-outline" size={17} color={sovereign ? tint : theme.textDim} />}
              <Text style={[styles.modeBtnTxt, sovereign && { color: tint }]}>{t("sm.049")}</Text>
            </TouchableOpacity>
          </View>
          {sovereign && (
            <View style={styles.testBox} testID="mesh-test">
              <MeshConstellation status={netHealth} t={t} tint={tint} details={
                <Text style={styles.modeMeta} testID="mesh-map-raw">
                  {(t("sm.050")) + ((netHealth && netHealth.neighbours) || 0)
                    + (t("sm.051")) + ((netHealth && netHealth.hybrid) || 0)
                    + (t("sm.052")) + ((netHealth && netHealth.mix) || 0)
                    + (t("sm.053")) + ((netHealth && netHealth.pulses) || 0)}
                </Text>
              } />
              <Text style={styles.testTitle}>{t("sm.054")}</Text>
              <Text style={styles.modeHint}>
                {t("sm.055")}
              </Text>
              <TouchableOpacity style={[styles.testBtn, { borderColor: tint }]} onPress={runProbe} disabled={testBusy} testID="mesh-test-probe">
                {testBusy ? <ActivityIndicator color={tint} /> : <Ionicons name="wifi-outline" size={17} color={tint} />}
                <Text style={[styles.testBtnTxt, { color: tint }]}>{t("sm.056")}</Text>
              </TouchableOpacity>
              {!!probeCode && (
                <Text style={styles.testOut} testID="mesh-test-sent">
                  {(t("sm.057")) + probeCode + (t("sm.058"))}
                </Text>
              )}
              <Text style={styles.testOut} testID="mesh-test-recv">
                {(t("sm.059")) + (netHealth ? netHealth.probes || 0 : 0)
                  + (netHealth && netHealth.probeCode ? (t("sm.060")) + netHealth.probeCode : "")}
              </Text>
              <TouchableOpacity style={[styles.testBtn, { borderColor: tint }]} onPress={runRelay} disabled={testBusy} testID="mesh-test-relay">
                <Ionicons name="git-network-outline" size={17} color={tint} />
                <Text style={[styles.testBtnTxt, { color: tint }]}>{t("sm.061")}</Text>
              </TouchableOpacity>
              {!!relayCode && (
                <Text style={styles.testOut} testID="mesh-test-relay-out">
                  {(() => {
                    const st = netHealth && netHealth.self;
                    if (!st) return t("sm.062");
                    if (st.done) return (t("sm.063")) + Math.round(st.ms / 100) / 10 + "s"
                      + (st.net ? (t("sm.064"))
                                : (t("sm.065")));
                    return (t("sm.066")) + st.hops + "/4 · " + Math.round(st.elapsed / 1000) + "s"
                      + (st.elapsed > 90000 ? (t("sm.067")) : "");
                  })()}
                </Text>
              )}
              <Text style={styles.modeMeta} testID="mesh-health-detail">
              {(t("sm.068")) + meshNode.healthLabel(netHealth ? netHealth.key : "isolated", en)
                + (t("sm.053")) + (netHealth ? netHealth.pulses : 0)
                + (t("sm.069"))}
              </Text>
              <Text style={styles.modeMeta} testID="mesh-diag">
              {(() => {
                const d = netHealth && netHealth.diag;
                if (!d) return t("sm.070");
                let l = (t("sm.071")) + (d.running ? (t("sm.072")) : (t("sm.073")))
                  + (d.ip ? " \u00b7 IP " + d.ip : "")
                  + (t("sm.074")) + d.tx
                  + (t("sm.075")) + d.rx
                  + (t("sm.076")) + d.loops
                  + (d.txErr ? (t("sm.077")) + d.txErr : "");
                l += "\n" + "Wi-Fi Direct: " + radioLabel(d.p2p, t)
                  + (t("sm.078")) + (d.p2pFound || 0)
                  + (t("sm.079")) + (d.p2pPeers || 0)
                  + (d.p2pClients ? (t("sm.080")) + d.p2pClients : "");
                l += "\n" + "Bluetooth: " + radioLabel(d.ble, t)
                  + (t("sm.081")) + (d.bleSeen || 0)
                  + (d.bleAt ? (t("sm.082")) + Math.max(0, Math.round((Date.now() - d.bleAt) / 1000)) + (t("sm.083")) : "");
                if (d.radioErr) l += "\n" + (t("sm.084")) + d.radioErr;
                l += "\n" + decdiag.line(en);
                if (meshQ && (meshQ.badSeal || meshQ.unknown || meshQ.delivered || meshQ.sent)) {
                  l += "\n" + (t("sm.085")) + meshQ.sent
                    + (t("sm.075")) + meshQ.delivered
                    + (t("sm.086")) + meshQ.badSeal
                    + (t("sm.087")) + meshQ.unknown;
                }
                l += "\n" + (t("sm.050")) + (netHealth.neighbours || 0)
                  + (t("sm.052")) + (netHealth.mix || 0)
                  + (t("sm.088")) + (meshQ ? meshQ.known : 0)
                  + (t("sm.089")) + (meshQ ? meshQ.queued : 0);
                if (d.targets) l += "\n" + (t("sm.090")) + d.targets;
                if (d.err) l += "\n" + (t("sm.091")) + d.err;
                if (!d.running) l += "\n" + (t("sm.092"));
                else if (d.loops > 0 && !d.probes) l += "\n" + (t("sm.093"));
                else if (d.running && d.tx > 0 && d.rx === 0) l += "\n" + (t("sm.094"));
                return l;
              })()}
              </Text>
            </View>
          )}
        </View>
        <View style={styles.divider} />
        <Row
          icon={pushOk ? "checkmark-circle-outline" : "alert-circle-outline"}
          label={t("sm.095")}
          hint={pushOk === null || pushBusy
            ? (t("sm.096"))
            : pushOk
              ? (t("sm.097"))
              : (t("sm.098"))}
          onPress={() => checkPush(true)}
          right={pushBusy ? <ActivityIndicator size="small" color={tint} /> : <Text style={{ color: pushOk ? theme.accent : theme.danger, fontSize: 12, fontWeight: "800" }}>{pushOk ? (t("sm.099")) : (t("sm.100"))}</Text>}
          testID="settings-push-status"
        />
        <View style={styles.divider} />
        <Row icon="shield-checkmark-outline" label={t("sm.121")}
          hint={t("sm.122")}
          onPress={() => navigation.navigate("Security")}
          right={<Ionicons name="chevron-forward-outline" size={18} color={theme.textFaint} />} testID="settings-security-audit" />
        <View style={styles.divider} />
        <Row icon="sync-circle-outline" label={t("sm.123")}
          hint={t("sm.124")}
          onPress={() => navigation.navigate("HandshakeKeys")}
          right={<Ionicons name="chevron-forward-outline" size={18} color={theme.textFaint} />} testID="settings-handshake-keys" />

        <View style={styles.divider} />
        <Row icon="shield-half-outline" label={t("sm.125")}
          hint={t("sm.126")}
          onPress={() => navigation.navigate("AfterBorder")} danger
          right={<Ionicons name="chevron-forward-outline" size={18} color={theme.danger} />} testID="settings-after-border" />
        <View style={styles.divider} />
        <Row icon="ban-outline" label={t("blk.title")}
          hint={t("blk.hint")}
          onPress={() => navigation.navigate("Blocked")}
          right={<Ionicons name="chevron-forward-outline" size={18} color={theme.textFaint} />} testID="settings-blocked" />
        <View style={styles.divider} />
        <Row icon="keypad-outline" label={t("sm.127")}
          hint={t("sm.128")}
          onPress={() => navigation.navigate("PrivacyLock")}
          right={<Ionicons name="chevron-forward-outline" size={18} color={theme.textFaint} />} testID="settings-privacy-lock" />
        <View style={styles.divider} />
        <Row icon="save-outline" label={t("sm.129")}
          hint={t("sm.130")}
          onPress={() => navigation.navigate("Backup")}
          right={<Ionicons name="chevron-forward-outline" size={18} color={theme.textFaint} />} testID="settings-backup" />
        <View style={styles.divider} />
        <Row icon="document-lock-outline" label={t("sm.131")}
          hint={t("sm.132")}
          onPress={() => Linking.openURL(`${DEFAULT_SERVER.replace(/\/$/, "")}/trasparenza.html`)}
          right={<Ionicons name="open-outline" size={18} color={theme.textFaint} />} testID="settings-transparency" />
        <View style={styles.divider} />
        <Row icon="alert-circle-outline" label={t("sm.133")}
          hint={t("sm.134")}
          onPress={() => Linking.openURL(`${DEFAULT_SERVER.replace(/\/$/, "")}/regole.html`)}
          right={<Ionicons name="open-outline" size={18} color={theme.textFaint} />} testID="settings-rules" />
        {isOss && (<>
        <View style={styles.divider} />
        <View style={{ paddingHorizontal: 18, paddingVertical: 12 }}>
          <Text style={{ color: theme.text, fontSize: 15, fontWeight: "600", marginBottom: 2 }}>🎯 {t("sm.135")}</Text>
          <Text style={{ color: theme.textDim, fontSize: 12, marginBottom: 10 }}>{t("sm.136")}</Text>

          <View style={{ flexDirection: "row", flexWrap: "wrap", marginBottom: 4 }}>
            {reminderTimes.map((tm) => (
              <TouchableOpacity key={`${tm.hour}:${tm.minute}`} onPress={() => removeTime(tm)} testID={`reminder-time-${tm.hour}-${tm.minute}`}
                style={{ flexDirection: "row", alignItems: "center", backgroundColor: tint, borderRadius: 14, paddingVertical: 6, paddingHorizontal: 12, marginRight: 8, marginBottom: 8 }}>
                <Text style={{ color: "#fff", fontSize: 13, fontWeight: "800" }}>{String(tm.hour).padStart(2, "0")}:{String(tm.minute).padStart(2, "0")}</Text>
                <Ionicons name="close-outline" size={14} color="#fff" style={{ marginLeft: 6 }} />
              </TouchableOpacity>
            ))}
            {reminderTimes.length === 0 && <Text style={{ color: theme.textFaint, fontSize: 12, marginBottom: 8 }}>{t("sm.137")}</Text>}
          </View>

          <Text style={{ color: theme.textFaint, fontSize: 11, fontWeight: "700", marginTop: 6, marginBottom: 4 }}>{t("sm.138")}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingRight: 8 }}>
            {Array.from({ length: 24 }, (_, h) => h).map((h) => (
              <TouchableOpacity key={h} onPress={() => setPickHour(h)} testID={`reminder-pick-hour-${h}`}
                style={{ borderWidth: 1, borderColor: theme.border, backgroundColor: pickHour === h ? tint : "transparent", borderRadius: 10, paddingVertical: 5, paddingHorizontal: 10, marginRight: 6 }}>
                <Text style={{ color: pickHour === h ? "#fff" : "#cfe0ff", fontSize: 12, fontWeight: "700" }}>{String(h).padStart(2, "0")}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <Text style={{ color: theme.textFaint, fontSize: 11, fontWeight: "700", marginTop: 10, marginBottom: 4 }}>{t("sm.139")}</Text>
          <View style={{ flexDirection: "row" }}>
            {[0, 15, 30, 45].map((m) => (
              <TouchableOpacity key={m} onPress={() => setPickMinute(m)} testID={`reminder-pick-min-${m}`}
                style={{ borderWidth: 1, borderColor: theme.border, backgroundColor: pickMinute === m ? tint : "transparent", borderRadius: 10, paddingVertical: 5, paddingHorizontal: 12, marginRight: 8 }}>
                <Text style={{ color: pickMinute === m ? "#fff" : "#cfe0ff", fontSize: 12, fontWeight: "700" }}>:{String(m).padStart(2, "0")}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <TouchableOpacity onPress={addTime} testID="reminder-add"
            style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, marginTop: 14, backgroundColor: "rgba(80,200,120,0.16)", borderWidth: 1, borderColor: tint, borderRadius: 12, paddingVertical: 10 }}>
            <Ionicons name="add-circle-outline" size={18} color={tint} />
            <Text style={{ color: "#cfe0ff", fontSize: 13, fontWeight: "800" }}>
              {t("sm.140")} {String(pickHour).padStart(2, "0")}:{String(pickMinute).padStart(2, "0")}
            </Text>
          </TouchableOpacity>
        </View>
        </>)}
      </View>

      {/* THREAT SHIELD */}
      <View style={styles.shieldBox} testID="settings-shield">
        <View style={styles.shieldHead}>
          <Ionicons name="shield-checkmark-outline" size={18} color={tint} />
          <Text style={styles.shieldTitle}>{lang !== "en" ? "Scudo Anti-Minacce" : "Threat Shield"}</Text>
          <View style={styles.shieldBadge}><Text style={styles.shieldBadgeTxt}>{lang !== "en" ? "CONTROLLI LOCALI" : "LOCAL CHECKS"}</Text></View>
        </View>
        <View style={styles.counterBox} testID="settings-threat-counter">
          <Text style={styles.counterNum}>{threatCount}</Text>
          <Text style={styles.counterLbl}>{lang !== "en" ? "rilevamenti registrati" : "logged detections"}</Text>
        </View>
        <View style={styles.weekChart} testID="settings-threat-week">
          <Text style={styles.weekTitle}>{lang !== "en" ? "Ultimi 7 giorni" : "Last 7 days"}</Text>
          <View style={styles.weekBars}>
            {weekBars.map((d, i) => (
              <View key={i} style={styles.weekCol}>
                <Text style={styles.weekVal}>{d.n > 0 ? d.n : ""}</Text>
                <View style={styles.weekTrack}>
                  <View style={[styles.weekFill, { height: `${Math.round((d.n / weekMax) * 100)}%`, backgroundColor: d.n > 0 ? tint : "transparent" }]} />
                </View>
                <Text style={styles.weekLbl}>{d.label}</Text>
              </View>
            ))}
          </View>
        </View>
        <Text style={styles.shieldDesc}>
          {lang !== "en"
            ? "Protezione dei messaggi sul dispositivo."
            : "On-device message protection."}
        </Text>
        {(lang !== "en"
          ? [
              "Euristiche per phishing e truffe nei messaggi (finti login, premi, frodi IBAN/cripto, richieste OTP).",
              "Link malevoli: imitazione marchi, cloni punycode, host solo-IP, accorciatori, domini a rischio, senza HTTPS.",
              "Allegati: eseguibili, doppie estensioni mascherate, macro Office, false immagini, firma magic-bytes.",
              `Domini caricati in memoria: ${threatListSize()}. La lista remota dipende dalla disponibilità del server.`,
              "Rilevamento firma di test antivirus EICAR.",
            ]
          : [
              "Phishing and scam heuristics in messages (fake logins, prizes, IBAN/crypto fraud, OTP requests).",
              "Malicious links: brand impersonation, punycode clones, IP-only hosts, shorteners, risky domains, non-HTTPS.",
              "Attachments: executables, disguised double extensions, Office macros, fake images, magic-byte signature.",
              `Domains loaded in memory: ${threatListSize()}. The remote list depends on server availability.`,
              "EICAR antivirus test signature detection.",
            ]
        ).map((line, i) => (
          <View key={i} style={styles.shieldItem}>
            <View style={styles.shieldDot} />
            <Text style={styles.shieldItemTxt}>{line}</Text>
          </View>
        ))}
      </View>

      <View style={styles.shieldBox} testID="settings-privacy">
        <Text style={styles.shieldTitle}>{en ? "Privacy and transparency" : "Privacy e trasparenza"}</Text>
        <Text style={styles.privHead}>{en ? "What stays on your device" : "Cosa resta sul dispositivo"}</Text>
        <Text style={styles.shieldDesc}>{en
          ? "Authentication sends signatures and public keys. Private profile fields and the app PIN stay local. An explicit key export or backup creates a separate copy under your control."
          : "L’autenticazione invia firme e chiavi pubbliche. I campi privati del profilo e il PIN dell’app restano locali. Esportare una chiave o un backup crea una copia separata sotto il tuo controllo."}</Text>
        <Text style={styles.privHead}>{en ? "What the server can process" : "Cosa può trattare il server"}</Text>
        <Text style={styles.shieldDesc}>{en
          ? "Account, public keys, public profile, encrypted envelopes where supported, delivery data and sign-in events. A server or proxy can see the IP and connection times. Retention and logs depend on its operator. Translation can send selected text to the service."
          : "Account, chiavi pubbliche, profilo pubblico, buste cifrate dove supportate, dati di consegna ed eventi di accesso. Server e proxy possono vedere IP e orari. Log e conservazione dipendono dal gestore. La traduzione può inviare al servizio il testo selezionato."}</Text>
        <Text style={styles.privHead}>{en ? "Public-area rules" : "Regole delle aree pubbliche"}</Text>
        <Text style={styles.shieldDesc}>{en
          ? "Share only material you are entitled to publish. Other people can read or copy published details. Avoid sharing private data, scams, harassment or malicious files."
          : "Condividi solo ciò che hai diritto di pubblicare. Chi vede i dati pubblici può copiarli. Evita dati privati, truffe, molestie e file malevoli."}</Text>
        <TouchableOpacity onPress={() => setShowLegal(true)} style={styles.legalLink} testID="settings-open-legal">
          <Ionicons name="document-text-outline" size={16} color={tint} />
          <Text style={styles.legalLinkTxt}>{en ? "Privacy details and public-area rules" : "Dettagli privacy e regole delle aree pubbliche"}</Text>
        </TouchableOpacity>
      </View>

      {/* THREAT LOG */}
      <View style={styles.shieldBox} testID="settings-threat-log">
        <View style={styles.threatLogHead}>
          <View style={styles.shieldHead2}>
            <Ionicons name="alert-circle-outline" size={16} color={tint} />
            <Text style={styles.shieldTitle}>{t("sm.141")}</Text>
          </View>
          {threatLog.length > 0 && (
            <TouchableOpacity onPress={emptyThreatLog} testID="threat-log-clear"><Text style={styles.threatClear}>{t("sm.142")}</Text></TouchableOpacity>
          )}
        </View>
        {threatLog.length === 0 ? (
          <Text style={styles.threatEmpty}>{t("sm.143")}</Text>
        ) : (
          threatLog.slice(0, 15).map((e, i) => (
            <View key={i} style={styles.threatItem}>
              <View style={[styles.threatDot, { backgroundColor: e.level === "danger" ? "#FF4D5E" : "#50C878" }]} />
              <View style={{ flex: 1 }}>
                <View style={styles.threatRow}>
                  <Text style={styles.threatCtx}>{e.context}</Text>
                  <Text style={styles.threatTime}>{fmtAgo(e.at, lang, t)}</Text>
                </View>
                <Text style={styles.threatReason} numberOfLines={2}>{e.reasons && e.reasons[0]}</Text>
              </View>
            </View>
          ))
        )}
      </View>

      {/* GDPR */}
      <Text style={styles.section}>{t("settings.section.gdpr")}</Text>
      <View style={styles.card}>
        <Row icon="download-outline" label={t("settings.export")} hint={en ? "Request a copy from your server. Availability depends on the operator." : "Richiedi una copia al tuo server. La disponibilità dipende dal gestore."} onPress={exporting ? null : doExport}
          right={exporting ? <ActivityIndicator size="small" color={tint} /> : <Ionicons name="chevron-forward-outline" size={18} color={theme.textFaint} />} testID="settings-export" />
        <View style={styles.divider} />
        <Row icon="trash-outline" label={t("settings.delete")} hint={en ? "Request account deletion from your server." : "Richiedi al tuo server l’eliminazione dell’account."} onPress={deleting ? null : doDelete} danger
          right={deleting ? <ActivityIndicator size="small" color={theme.danger} /> : <Ionicons name="chevron-forward-outline" size={18} color={theme.danger} />} testID="settings-delete" />
      </View>
      <View style={styles.infoBox}>
        <Ionicons name="lock-closed-outline" size={16} color={theme.accent} />
        <View style={{ flex: 1 }}>
          <Text style={styles.infoTitle}>{t("settings.dataInfoTitle")}</Text>
          <Text style={styles.infoText}>{en
            ? "Conversation envelopes and attachments can be encrypted on the device. Availability and metadata depend on the communication path. See Security and audit."
            : "Buste delle conversazioni e allegati possono essere cifrati sul dispositivo. Disponibilità e metadati dipendono dal percorso di comunicazione. Vedi Sicurezza e audit."}</Text>
        </View>
      </View>

      <View style={styles.infoBox}>
        <Ionicons name="cloud-download-outline" size={16} color={tint} />
        <View style={{ flex: 1 }}>
          <Text style={styles.infoTitle}>{t("sm.101")}</Text>
          <Text style={styles.infoText} testID="settings-update-info">
            {upMsg || (t("sm.102"))}
          </Text>
          <TouchableOpacity style={styles.updBtn} onPress={doCheckUpdate} disabled={upBusy} testID="settings-check-update">
            {upBusy ? <ActivityIndicator color={tint} /> : (
              <Text style={styles.updBtnTxt}>{t("sm.103")}</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.infoBox}>
        <Ionicons name="people-outline" size={16} color={theme.accent} />
        <View style={{ flex: 1 }}>
          <Text style={styles.infoTitle} testID="settings-contacts-info-title">{t("sm.104")}</Text>
          <Text style={styles.infoText} testID="settings-contacts-info">
            {t("sm.105")}
          </Text>
        </View>
      </View>

      {/* LEGAL */}
      <Text style={styles.section}>{t("settings.section.legal")}</Text>
      <View style={styles.card}>
        {LEGAL_DOCS.map((d, i) => (
          <View key={d.path}>
            {i > 0 && <View style={styles.divider} />}
            <Row icon={d.icon} label={t(d.key)} onPress={() => openLegal(d)} right={<Ionicons name="open-outline" size={17} color={theme.textFaint} />} testID={`settings-legal-${d.path}`} />
          </View>
        ))}
      </View>
      <View style={styles.card}>
        <Row icon="business-outline" label={t("settings.controller")} hint={t("settings.controllerName")} testID="settings-controller" />
        {!!PRIVACY_LNS && <>
          <View style={styles.divider} />
          <Row icon="chatbubble-ellipses-outline" label={t("settings.contact")} hint={PRIVACY_LNS} onPress={() => navigation.navigate("Chat", { conv_id: null, others: [PRIVACY_LNS], title: "Contatto privacy", title_lns: PRIVACY_LNS })}
            right={<Ionicons name="chevron-forward-outline" size={18} color={theme.textFaint} />} testID="settings-contact" />
        </>}
      </View>

      {/* ABOUT */}
      <Text style={styles.section}>{t("settings.section.about")}</Text>
      <View style={styles.card}>
        <Row icon="shield-outline" label={t("settings.encryption")} hint={t("settings.encryptionVal")} testID="settings-encryption" />
        <View style={styles.divider} />
        <Row icon="information-circle-outline" label={t("settings.version")} hint={`${Constants.expoConfig?.version || "1.0.0"} · Versione Zero (${Constants.expoConfig?.android?.versionCode || "1"})`} testID="settings-version" />
        <View style={styles.divider} />
        {isOwner && (
          <>
            <Row icon="flag-outline" label={t("sm.106")}
              hint={t("sm.107")}
              onPress={() => navigation.navigate("Reports")}
              right={<Ionicons name="chevron-forward-outline" size={18} color={theme.textFaint} />} testID="settings-reports" />
            <View style={styles.divider} />
          </>
        )}
        <Row icon="id-card-outline" label={t("sm.108")}
          hint={t("sm.109")}
          onPress={shareCard}
          right={<Ionicons name="share-social-outline" size={18} color={tint} />} testID="settings-card" />
        <View style={styles.divider} />
        <Row icon="person-add-outline" label={t("sm.110")}
          hint={t("sm.111")}
          onPress={inviteFriend}
          right={<Ionicons name="share-social-outline" size={18} color={tint} />} testID="settings-invite" />
        <View style={styles.divider} />
        <View style={styles.divider} />
        <Row icon="ribbon-outline" label={en ? "Informational receipt" : "Ricevuta informativa"} hint={en ? "Security and privacy summary (PDF)" : "Riepilogo di sicurezza e privacy (PDF)"} onPress={genPdf ? null : doCompliance}
          right={genPdf ? <ActivityIndicator size="small" color={tint} /> : <Ionicons name="download-outline" size={18} color={theme.textFaint} />} testID="settings-compliance" />
      </View>

      <TouchableOpacity onPress={() => Alert.alert(t("signout"), en
        ? "Keep your key file before signing out."
        : "Conserva il file chiave prima di uscire.",
      [{ text: t("cancel"), style: "cancel" }, { text: t("signout"), style: "destructive", onPress: signOut }])}
        style={styles.signout} testID="settings-signout">
        <Ionicons name="log-out-outline" size={18} color={theme.danger} />
        <Text style={styles.signoutText}>{t("signout")}</Text>
      </TouchableOpacity>

      <Modal visible={showDelete} transparent animationType="fade" onRequestClose={() => setShowDelete(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalIcon}><Ionicons name="warning-outline" size={26} color={theme.danger} /></View>
            <Text style={styles.modalTitle}>{t("settings.delete.title")}</Text>
            <Text style={styles.modalText}>{t("settings.delete.confirm")}</Text>
            <Text style={styles.modalHint}>{t("delete.typeToConfirm", { word: t("delete.word") })}</Text>
            <TextInput
              style={styles.modalInput}
              value={delText}
              onChangeText={setDelText}
              placeholder={t("delete.placeholder")}
              placeholderTextColor={theme.textFaint}
              autoCapitalize="characters"
              autoCorrect={false}
              testID="settings-delete-input"
            />
            <View style={styles.modalBtns}>
              <TouchableOpacity style={styles.modalCancel} onPress={() => setShowDelete(false)} disabled={deleting} testID="settings-delete-cancel">
                <Text style={styles.modalCancelTxt}>{t("cancel")}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalDelete, (delText.trim().toUpperCase() !== t("delete.word") || deleting) && styles.modalDeleteDisabled]}
                disabled={delText.trim().toUpperCase() !== t("delete.word") || deleting}
                onPress={confirmDelete}
                testID="settings-delete-confirm"
              >
                {deleting ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.modalDeleteTxt}>{t("delete.confirmBtn")}</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={showLegal} transparent animationType="slide" onRequestClose={() => setShowLegal(false)}>
        <View style={styles.legalWrap}>
          <View style={styles.legalCard}>
            <View style={styles.legalHead}>
              <Text style={styles.legalTitle}>{lang !== "en" ? "Privacy e regole delle aree pubbliche" : "Privacy and public-area rules"}</Text>
              <TouchableOpacity onPress={() => setShowLegal(false)} testID="settings-legal-close"><Ionicons name="close-outline" size={24} color={theme.text} /></TouchableOpacity>
            </View>
            <ScrollView style={{ maxHeight: "82%" }} contentContainerStyle={{ paddingBottom: 24 }}>
              <Text style={styles.legalBody}>{lang !== "en" ? LEGAL_IT : LEGAL_EN}</Text>
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal visible={showTrLang} transparent animationType="slide" onRequestClose={() => setShowTrLang(false)}>
        <View style={styles.legalWrap}>
          <View style={styles.legalCard}>
            <View style={styles.legalHead}>
              <Text style={styles.legalTitle}>{t("sm.119")}</Text>
              <TouchableOpacity onPress={() => setShowTrLang(false)} testID="settings-trlang-close"><Ionicons name="close-outline" size={24} color={theme.text} /></TouchableOpacity>
            </View>
            <TextInput
              style={styles.trSearch}
              value={trSearch}
              onChangeText={setTrSearch}
              placeholder={t("sm.144")}
              placeholderTextColor={theme.textFaint}
              autoCorrect={false}
              testID="settings-trlang-search"
            />
            <ScrollView style={{ maxHeight: "72%" }} contentContainerStyle={{ paddingBottom: 24 }} keyboardShouldPersistTaps="handled">
              {!trSearch.trim() && (
                <TouchableOpacity style={styles.trItem} onPress={async () => { setTrTarget(null); await saveTranslateTarget(""); setShowTrLang(false); }} testID="settings-trlang-auto">
                  <Text style={[styles.trItemTxt, !trTarget && { color: tint, fontWeight: "800" }]}>{t("sm.120")}</Text>
                  {!trTarget && <Ionicons name="checkmark-outline" size={18} color={tint} />}
                </TouchableOpacity>
              )}
              {TRANSLATE_LANGS.filter((l) => { const q = trSearch.trim().toLowerCase(); return !q || l.name.toLowerCase().includes(q) || l.code.toLowerCase().includes(q); }).map((l) => (
                <TouchableOpacity key={l.code} style={styles.trItem} onPress={async () => { setTrTarget(l.code); await saveTranslateTarget(l.code); setShowTrLang(false); }} testID={`settings-trlang-${l.code}`}>
                  <Text style={[styles.trItemTxt, trTarget === l.code && { color: tint, fontWeight: "800" }]}>{l.name}</Text>
                  {trTarget === l.code && <Ionicons name="checkmark-outline" size={18} color={tint} />}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

    </ScrollView>
  );
}

const makeStyles = (tint) => StyleSheet.create({
  serverInput: { color: theme.text, borderColor: theme.border, borderWidth: 1, borderRadius: 8, marginVertical: 10, padding: 10 },
  root: { flex: 1, backgroundColor: "transparent" },
  title: { color: theme.text, fontSize: 26, fontWeight: "800", paddingHorizontal: 18, marginBottom: 6 },
  section: { color: theme.textFaint, fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1, marginTop: 22, marginBottom: 8, paddingHorizontal: 18 },
  privStatus: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingHorizontal: 18, marginBottom: 10 },
  privPill: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 6 },
  privDot: { width: 9, height: 9, borderRadius: 5 },
  privPillTxt: { fontSize: 12, fontWeight: "600" },
  modeBox: { paddingHorizontal: 16, paddingVertical: 14 },
  modeTitle: { color: theme.text, fontSize: 15, fontWeight: "700" },
  modeHint: { color: theme.textDim, fontSize: 12, lineHeight: 17, marginTop: 4 },
  modeRow: { flexDirection: "row", gap: 10, marginTop: 12 },
  modeBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, borderWidth: 1, borderColor: theme.border, borderRadius: 12, paddingVertical: 11 },
  modeBtnTxt: { color: theme.textDim, fontSize: 13, fontWeight: "700" },
  modeMeta: { color: theme.textFaint, fontSize: 11, lineHeight: 16, marginTop: 10 },
  testBox: { marginTop: 14, borderTopWidth: 1, borderTopColor: theme.border, paddingTop: 14 },
  testTitle: { color: theme.text, fontSize: 14, fontWeight: "700", marginBottom: 2 },
  testBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderWidth: 1, borderRadius: 12, paddingVertical: 11, marginTop: 10 },
  testBtnTxt: { fontSize: 13, fontWeight: "700" },
  testOut: { color: theme.textDim, fontSize: 11, lineHeight: 16, marginTop: 8 },
  card: { backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, borderRadius: 14, marginHorizontal: 14, marginBottom: 10, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 14 },
  rowLabel: { color: theme.text, fontSize: 15, fontWeight: "600" },
  lookLabel: { color: theme.textDim, fontSize: 11, fontWeight: "800", letterSpacing: 1.2, textTransform: "uppercase" },
  lookRow: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginTop: 12 },
  swatch: { width: 38, height: 38, borderRadius: 999, alignItems: "center", justifyContent: "center" },
  swatchOn: { borderWidth: 2, borderColor: "#fff" },
  lookHint: { color: theme.textFaint, fontSize: 12, lineHeight: 18, marginTop: 16 },
  rowHint: { color: theme.textDim, fontSize: 12, marginTop: 2 },
  divider: { height: 1, backgroundColor: theme.border, marginLeft: 52 },
  langWrap: { flexDirection: "row", flexWrap: "wrap", gap: 6, paddingHorizontal: 14, paddingBottom: 12 },
  langBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: theme.border },
  langBtnActive: { backgroundColor: tint, borderColor: tint },
  langTxt: { color: theme.textDim, fontSize: 12, fontWeight: "700" },
  infoBox: { flexDirection: "row", gap: 10, alignItems: "flex-start", backgroundColor: "rgba(80,200,120,0.07)", borderWidth: 1, borderColor: "rgba(80,200,120,0.25)", borderRadius: 12, padding: 14, marginHorizontal: 14 },
  infoTitle: { color: theme.accent, fontSize: 13, fontWeight: "700", marginBottom: 4 },
  infoText: { color: theme.textDim, fontSize: 12, lineHeight: 18 },
  updBtn: { alignSelf: "flex-start", marginTop: 10, borderWidth: 1, borderColor: tint, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  updBtnTxt: { color: tint, fontSize: 11, fontWeight: "800", letterSpacing: 0.6 },
  shieldBox: { backgroundColor: "rgba(80,200,120,0.06)", borderWidth: 1, borderColor: "rgba(80,200,120,0.28)", borderRadius: 14, padding: 14, marginHorizontal: 14, marginBottom: 10 },
  legalLink: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: theme.border },
  legalLinkTxt: { color: tint, fontSize: 13, fontWeight: "700", flex: 1 },
  legalWrap: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" },
  legalCard: { backgroundColor: theme.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 18, maxHeight: "90%" },
  legalHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  legalTitle: { color: theme.text, fontSize: 18, fontWeight: "800" },
  legalBody: { color: theme.text, fontSize: 12.5, lineHeight: 19 },
  trSearch: { backgroundColor: "transparent", borderWidth: 1, borderColor: theme.border, borderRadius: 10, color: theme.text, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, marginBottom: 8 },
  trItem: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 13, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: theme.border },
  trItemTxt: { color: theme.text, fontSize: 15, flex: 1 },
  counterBox: { flexDirection: "row", alignItems: "baseline", gap: 8, marginTop: 12, marginBottom: 4, paddingVertical: 10, paddingHorizontal: 12, backgroundColor: "rgba(80,200,120,0.10)", borderRadius: 10, borderWidth: 1, borderColor: "rgba(80,200,120,0.25)" },
  counterNum: { color: tint, fontSize: 26, fontWeight: "900" },
  counterLbl: { color: theme.textDim, fontSize: 12, fontWeight: "600", flex: 1 },
  weekChart: { marginBottom: 6, paddingVertical: 10, paddingHorizontal: 12, backgroundColor: "rgba(80,200,120,0.06)", borderRadius: 10, borderWidth: 1, borderColor: "rgba(80,200,120,0.18)" },
  weekTitle: { color: theme.textFaint, fontSize: 10, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 },
  weekBars: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", height: 72 },
  weekCol: { flex: 1, alignItems: "center", gap: 3 },
  weekVal: { color: tint, fontSize: 10, fontWeight: "800", height: 12 },
  weekTrack: { width: 14, height: 40, backgroundColor: "rgba(255,255,255,0.05)", borderRadius: 4, justifyContent: "flex-end", overflow: "hidden" },
  weekFill: { width: "100%", borderRadius: 4, minHeight: 2 },
  weekLbl: { color: theme.textFaint, fontSize: 9, fontWeight: "600", textTransform: "capitalize" },
  shieldHead: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  shieldTitle: { color: theme.text, fontSize: 15, fontWeight: "800" },
  shieldBadge: { backgroundColor: "rgba(80,200,120,0.14)", borderWidth: 1, borderColor: "rgba(80,200,120,0.35)", borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
  shieldBadgeTxt: { color: theme.accent, fontSize: 9, fontWeight: "800", letterSpacing: 0.5 },
  shieldDesc: { color: theme.textDim, fontSize: 12.5, lineHeight: 18, marginTop: 8, marginBottom: 8 },
  shieldItem: { flexDirection: "row", gap: 8, alignItems: "flex-start", marginTop: 6 },
  shieldDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: tint, marginTop: 6 },
  shieldItemTxt: { color: theme.text, fontSize: 12.5, lineHeight: 18, flex: 1 },
  privHead: { color: theme.text, fontSize: 13.5, fontWeight: "800", marginTop: 14, marginBottom: 8 },
  privLegal: { color: theme.textFaint, fontSize: 11.5, lineHeight: 17, marginTop: 14, fontStyle: "italic", borderTopWidth: 1, borderTopColor: theme.border, paddingTop: 12 },
  threatLogHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  shieldHead2: { flexDirection: "row", alignItems: "center", gap: 8 },
  threatClear: { color: tint, fontSize: 12, fontWeight: "700" },
  threatEmpty: { color: theme.textDim, fontSize: 12.5, lineHeight: 18, marginTop: 8 },
  threatItem: { flexDirection: "row", gap: 10, alignItems: "flex-start", marginTop: 10 },
  threatDot: { width: 8, height: 8, borderRadius: 4, marginTop: 5 },
  threatRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  threatCtx: { color: theme.text, fontSize: 12.5, fontWeight: "800" },
  threatTime: { color: theme.textDim, fontSize: 10.5 },
  threatReason: { color: theme.textDim, fontSize: 12, lineHeight: 16, marginTop: 1 },
  signout: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 26, paddingVertical: 12 },
  signoutText: { color: theme.danger, fontSize: 14, fontWeight: "700" },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.7)", alignItems: "center", justifyContent: "center", padding: 24 },
  modalCard: { width: "100%", backgroundColor: theme.surfaceAlt, borderRadius: 18, borderWidth: 1, borderColor: theme.border, padding: 22 },
  modalIcon: { width: 52, height: 52, borderRadius: 26, backgroundColor: "rgba(242,244,243,0.12)", alignItems: "center", justifyContent: "center", alignSelf: "center", marginBottom: 14 },
  modalTitle: { color: theme.text, fontSize: 19, fontWeight: "800", textAlign: "center" },
  modalText: { color: theme.textDim, fontSize: 13, lineHeight: 19, textAlign: "center", marginTop: 10 },
  modalHint: { color: theme.textFaint, fontSize: 12, textAlign: "center", marginTop: 14 },
  modalInput: { backgroundColor: "transparent", borderWidth: 1, borderColor: theme.border, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, color: theme.text, fontSize: 16, fontWeight: "700", letterSpacing: 2, textAlign: "center", marginTop: 8 },
  modalBtns: { flexDirection: "row", gap: 12, marginTop: 18 },
  modalCancel: { flex: 1, borderWidth: 1, borderColor: theme.border, borderRadius: 12, paddingVertical: 14, alignItems: "center" },
  modalCancelTxt: { color: theme.textDim, fontWeight: "700" },
  modalDelete: { flex: 1, backgroundColor: theme.danger, borderRadius: 12, paddingVertical: 14, alignItems: "center" },
  modalDeleteDisabled: { opacity: 0.4 },
  modalDeleteTxt: { color: "#fff", fontWeight: "800" },
});
