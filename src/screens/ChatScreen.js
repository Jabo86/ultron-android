import DirectPollComposer from "../components/DirectPollComposer";
import DirectPollCard from "../components/DirectPollCard";
import {readPollPacket,pollBody,makeDirectPoll} from "../lib/directPolls";
import {syncDirectPolls,saveDirectPollSecret,quizReveals,forgetDirectPoll} from "../lib/directPollStore";
import AttachmentSheet from "../components/AttachmentSheet";
import EncryptionNotice from "../components/EncryptionNotice";
import React, { useState, useEffect, useCallback, useRef, useLayoutEffect, useMemo } from "react";
import { View, StyleSheet, ScrollView, FlatList, TouchableOpacity, ActivityIndicator, Alert, AppState, Keyboard, InteractionManager } from "react-native";
import { Text, TextInput } from "../components/HudText";
import ChatMessageMenu from "../components/ChatMessageMenu";
import { copyMessageText, shareMessageText, useMessagePreferences } from "../lib/chatMessageActions";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import * as ImagePicker from "expo-image-picker";
import * as imageOpt from "../lib/imageOpt";
import * as appearance from "../lib/appearance";
import * as DocumentPicker from "../lib/documentPicker";
import * as bigatt from "../lib/bigatt";
import * as FileSystem from "expo-file-system/legacy";
import { useAudioRecorder, useAudioRecorderState, AudioModule, RecordingPresets, setAudioModeAsync } from "expo-audio";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { DEFAULT_SERVER } from "../config";
import { useHeaderHeight } from "@react-navigation/elements";
import { useAuth } from "../context/AuthContext";
import { useUnread } from "../context/UnreadContext";
import * as api from "../lib/api";
import { decryptAny } from "../lib/devices";
import { hostedRatchetPilot, readPilotMessage, registerHostedRatchet } from "../lib/hostedRatchetChat";
import { decidePilotGroupInvitation, pilotInvitationInbox, preparePilotGroupInvites, verifyPilotGroupAccount } from "../lib/pilotGroups";
import { buildEnvelopes, sendChatMessage } from "../lib/send";
import * as msh from "../lib/meshchat";
import * as decdiag from "../lib/decdiag";
import * as ratchetheal from "../lib/ratchetheal";
import { localPrekeyIds, deviceId as myDeviceId } from "../lib/devices";
import * as mbx from "../lib/mailbox";
import {
  decryptEnvelope, unpackMessage, encryptForRecipients, packMessage, bytesToHex,
  encryptFileBytesAsync, base64ToBytes, verifyMessage, decryptFileBytes, sha256Hex,
} from "../lib/crypto";
import EncryptedAttachment from "../components/EncryptedAttachment";
import ThreatBanner from "../components/ThreatBanner";
import SafeText from "../components/SafeText";
import { analyzeMessage } from "../lib/threatEngine";
import { useI18n } from "../lib/i18n";
import { loadTranslateTarget } from "../lib/store";
import { detectLang, langFlag } from "../lib/detectLang";
import { suppressLock, withSystemActivity } from "../lib/lockGuard";
import { getVerified, verifyState } from "../lib/verify";
import { archiveForConv } from "../lib/backup";
import { usePoll } from "../lib/usePoll";
import * as msgCache from "../lib/msgCache";
import * as convCache from "../lib/convCache";
import { checkPilotChat, deletePilotChat } from "../lib/pilotChatPurge";
import { flushBlobs } from "../lib/lock";
import { exportConversation } from "../lib/legalExport";
import { useTint } from "../lib/appearance";
import { theme } from "../theme";

// ── ORA E GIORNATA (v2.8.0) ────────────────────────────────────────────────
// Prima le bolle non dicevano quando: si vedeva l'ordine, non l'orario. Da qui l'ora
// sotto ogni messaggio e una riga di separazione quando cambia il giorno.
const DATE_LOCALE = {
  it: "it-IT", en: "en-GB", zh: "zh-CN", hi: "hi-IN", es: "es-ES", pt: "pt-BR",
  ar: "ar-SA", fr: "fr-FR", ru: "ru-RU", de: "de-DE", ja: "ja-JP", tr: "tr-TR",
};

function dayKeyOf(iso) {
  const d = new Date(iso || 0);
  if (isNaN(d)) return "";
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

function hhmm(iso) {
  const d = new Date(iso || 0);
  if (isNaN(d)) return "";
  return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
}

function dayLabelOf(iso, lang, t) {
  const d = new Date(iso || 0);
  if (isNaN(d)) return "";
  const k = dayKeyOf(iso);
  const now = new Date();
  if (k === dayKeyOf(now.toISOString())) return t("chat.today");
  if (k === dayKeyOf(new Date(now.getTime() - 86400000).toISOString())) return t("chat.yesterday");
  try {
    return d.toLocaleDateString(DATE_LOCALE[lang] || "it-IT", { weekday: "long", day: "numeric", month: "long" });
  } catch { return k; }
}

// Il testo che sostituisce una busta che non si apre. Costante e non ripetuta a mano:
// serve sia per disegnarla sia per riconoscerla quando si butta.
const UNDEC = "· messaggio non decifrabile ·";

export default function ChatScreen({ route, navigation }) {
  const tint = useTint();
  const styles = useMemo(() => makeStyles(tint), [tint]);
  const { user } = useAuth();
  const { t, lang } = useI18n();
  const { refresh } = useUnread();
  const insets = useSafeAreaInsets();
  const [convId, setConvId] = useState(route.params?.conv_id || null);
  const [replyTo, setReplyTo] = useState(null);
  const [editing, setEditing] = useState(null);
  const [others, setOthers] = useState(
    route.params?.others?.length ? route.params.others : (route.params?.title_lns ? [route.params.title_lns] : [])
  );
  const [headerTitle, setHeaderTitle] = useState(
    route.params?.title || (route.params?.title_lns || (route.params?.others?.[0]) || "Chat").split("@")[0]
  );
  const title = headerTitle;
  const [msgs, setMsgs] = useState([]);
  const [showPollComposer,setShowPollComposer]=useState(false);
  const [pollBusy,setPollBusy]=useState(false);
  const pollPrepared=useRef(null);
  const pollSubmitBusy=useRef(false);
  const [pollState,setPollState]=useState({polls:new Map(),secrets:{}});
  const pollSyncSignature=useRef("");
  const pollRevealing=useRef(new Set());
  const pollStateRef=useRef({polls:new Map(),secrets:{}});
  useEffect(()=>{pollStateRef.current={polls:new Map(),secrets:{}};setPollState(pollStateRef.current);pollSyncSignature.current="";},[convId]);
  const [groupInvites, setGroupInvites] = useState(null);
  const [groupInviteActions, setGroupInviteActions] = useState({});
  const [busyInvite, setBusyInvite] = useState(null);
  const documentFlow = useRef(false);
  const [draftDocuments, setDraftDocuments] = useState([]);
  const documentDraft = useRef([]);
  const documentUploads = useRef(new Set());
  const documentPrepared = useRef(null);
  const discardDocuments = async (files) => {
    for (const file of files) if (FileSystem.cacheDirectory && file.uri?.startsWith(FileSystem.cacheDirectory)) {
      await FileSystem.deleteAsync(file.uri, { idempotent: true }).catch(() => {});
    }
  };
  useEffect(() => () => {
    const files = documentDraft.current;
    documentDraft.current = [];
    Promise.allSettled([...documentUploads.current]).then(() => discardDocuments(files));
  }, [convId]);
  const inviteBusyRef = useRef(false);
  const invitePreparedAt = useRef(0);
  const [invitePrepFailed, setInvitePrepFailed] = useState(false);
  const [purging, setPurging] = useState(false);
  // Quanti messaggi si decifrano e si disegnano: 12 all'apertura, +30 ogni volta che
  // l'utente chiede i precedenti. `total` è quanti ce ne sono in tutto sul server.
  const INITIAL_WIN = 12;
  const PAGE = 30;
  const winRef = useRef(INITIAL_WIN);
  const [win, setWin] = useState(INITIAL_WIN);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  // La lista scende in fondo da sola SOLO se l'utente è già in fondo: prima lo faceva ad
  // ogni cambio di contenuto (anche ogni 4 secondi, e al caricamento di ogni immagine) ed
  // era il motivo per cui la chat "ballava".
  const atBottomRef = useRef(true);
  const moreRef = useRef(0);
  // Altezza già misurata di ogni messaggio: il posto resta quello anche quando il testo
  // arriva dopo (decifratura in sottofondo), così la lista non si riassesta sotto le dita.
  const rowH = useRef(new Map());
  // Aspetto scelto dall'utente (colore d'accento e sfondo): si applica qui, dove conta.
  const [look, setLook] = useState(appearance.get());
  useEffect(() => {
    appearance.load().then((v) => setLook({ ...v }));
    return appearance.subscribe((v) => setLook({ ...v }));
  }, []);
  const accent = (appearance.ACCENTS.find((a) => a.id === look.accent) || appearance.ACCENTS[0]).color;
  const chatBg = (appearance.BACKGROUNDS.find((b) => b.id === look.bg) || appearance.BACKGROUNDS[0]).color;
  const [text, setText] = useState("");
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [emojiOpen,setEmojiOpen]=useState(false);
  const [keyboardVisible,setKeyboardVisible]=useState(false);
  const inputRef=useRef(null);
  const inputSelection=useRef({start:0,end:0});
  const emojiChoices=['😀','😁','😂','😊','😍','🥰','😘','😉','😎','🤔','😮','😢','😭','😡','👍','👎','🙏','👏','❤️','💙','🎉','🔥','✅','💪','🤝','✨','🌍','📎'];
  const [actionItem, setActionItem] = useState(null);
  const [uploadPct, setUploadPct] = useState(null);
  const [typers, setTypers] = useState([]);
  const [translations, setTranslations] = useState({});
  const typingRef = useRef(0);
  const sendingRef = useRef([]);  // messaggi appena inviati: visibili subito
  const pendingRef = useRef(false);
  const msgsSig = useRef("");
  const [serverHasMessages, setServerHasMessages] = useState(false);
  const serverCursor = useRef({ cid: null, id: null });
  const netDone = useRef(false);   // la rete ha già risposto per questa chat
  const arcRef = useRef({ cid: null, list: [] });
  const anonRef = useRef({ cid: null, list: [], dirty: true });
  // La Costellazione del messaggio: chiusa di default, si apre toccando il lucchetto.
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);
  const listRef = useRef(null);
  const mounted = useRef(true);
  const ephemRef = useRef(new Set()); // id già schedulati per autodistruzione
  // Autodistruzione: 0=off, altrimenti secondi (60=1min, 3600=1h, 86400=24h)
  const [ttl, setTtl] = useState(0);
  const TTL_OPTS = [0, 60, 3600, 86400];
  const ttlLabel = (v) => (v === 0 ? "∞" : v === 60 ? "1m" : v === 3600 ? "1h" : "24h");
  const cycleTtl = () => setTtl((v) => TTL_OPTS[(TTL_OPTS.indexOf(v) + 1) % TTL_OPTS.length]);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recState = useAudioRecorderState(recorder);
  useEffect(() => { (async () => { try { await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true }); } catch { /* */ } })(); }, []);
  const mmss = (s) => { s = Math.max(0, Math.round(s || 0)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
  const headerHeight = useHeaderHeight();
  const scrollToEnd = useCallback((animated = false) => { listRef.current?.scrollToEnd({ animated }); }, []);
  useEffect(()=>{
    const show=Keyboard.addListener('keyboardDidShow',()=>{setKeyboardVisible(true);if(atBottomRef.current)requestAnimationFrame(()=>scrollToEnd(false));});
    const hide=Keyboard.addListener('keyboardDidHide',()=>setKeyboardVisible(false));
    return()=>{show.remove();hide.remove();};
  },[scrollToEnd]);

  // Verifica contatto (anti man-in-the-middle): "none" | "ok" | "changed" | "unknown"
  const [vfy, setVfy] = useState("none");
  useEffect(() => {
    if (others.length !== 1) return;
    let alive = true;
    const run = () => { verifyState(others[0]).then((r) => { if (alive) setVfy(r.state); }).catch(() => {}); };
    run();
    const unsub = navigation.addListener("focus", run);
    return () => { alive = false; unsub(); };
  }, [others, navigation]);

  const [exporting, setExporting] = useState(false);
  const exportRef = useRef({});
  exportRef.current = { msgs, others, title, user, lang, t };
  const exportingRef = useRef(false);
  const onExport = useCallback(() => {
    const { msgs, others, title, user, lang, t } = exportRef.current;
    if (exportingRef.current) return;
    const run = async () => {
      exportingRef.current = true; setExporting(true);
      try {
        const parts = Array.from(new Set([user?.lns, ...(others || [])].filter(Boolean)));
        const rows = (msgs || []).map((m) => ({ at: m.at, from: m.mine ? user.lns : (others[0] || title), body: m.body, atts: m.atts }));
        const downloadAttachment = async (a) => { const ct = await api.blobDownload(a.id); return decryptFileBytes(ct, a.key, a.iv); };
        const r = await exportConversation({ title, participants: parts, messages: rows, user, lang, downloadAttachment });
        Alert.alert(lang === "en" ? "Export ready" : "Export pronto", (lang === "en" ? "Signed on device · " : "Firmato sul dispositivo · ") + r.count + (lang === "en" ? " messages" : " messaggi"));
      } catch (e) { Alert.alert("Export", String((e && e.message) || e)); }
      finally { exportingRef.current = false; setExporting(false); }
    };
    Alert.alert(
      lang === "en" ? "Export conversation" : "Esporta conversazione",
      lang === "en" ? "Generate a signed PDF + JSON on your device (server sees nothing)?" : "Generare un PDF + JSON firmati sul tuo dispositivo (il server non vede nulla)?",
      [{ text: t("cancel"), style: "cancel" }, { text: lang === "en" ? "Export" : "Esporta", onPress: run }]
    );
  }, []);

  useLayoutEffect(() => {
    navigation.setOptions({
      title,
      headerTitle: others.length === 1 ? () => (
        <TouchableOpacity accessibilityRole="button" onPress={() => navigation.navigate("Profilo", { peer: others[0] })}
          testID="chat-open-profile" hitSlop={8}>
          <Text numberOfLines={1} style={{ color: theme.text, fontSize: 17, fontWeight: "700" }}>{title}</Text>
        </TouchableOpacity>
      ) : undefined,
      headerRight: () => (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
          {others.length === 1 && (
            <>
              <TouchableOpacity onPress={() => navigation.navigate("Call", { to: others[0], to_name: title, video: false })} testID="chat-call-audio" accessibilityLabel={lang === "en" ? "Voice call" : "Chiamata vocale"} style={{ minWidth: 46, minHeight: 44, borderRadius: 14, backgroundColor: tint + "22", borderWidth: 1, borderColor: tint + "66", alignItems: "center", justifyContent: "center" }}>
                <Ionicons name="call" size={20} color={tint} />
              </TouchableOpacity>
            </>
          )}
          {others.length === 1 && (
            <TouchableOpacity
              onPress={() => navigation.navigate("VerifyContact", { peer: others[0], peer_name: title })}
              testID="chat-verify" hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
            >
              <Ionicons
                name={vfy === "ok" ? "shield-checkmark" : vfy === "changed" ? "warning" : "shield-outline"}
                size={19}
                color={vfy === "ok" ? theme.accent : vfy === "changed" ? theme.danger : theme.textDim}
              />
            </TouchableOpacity>
          )}
          <TouchableOpacity onPress={onExport} testID="chat-export" hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}>
            {exporting ? <ActivityIndicator size="small" color={tint} /> : <Ionicons name="document-text-outline" size={20} color={tint} />}
          </TouchableOpacity>
          {convId ? (
            <TouchableOpacity onPress={onDeleteChat} testID="chat-delete" hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Text style={{ color: "#FF6B7A", fontSize: 18 }}>🗑</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ),
    });
  }, [navigation, title, convId, others, exporting, onExport, vfy, user, lang]);

  const pilot = hostedRatchetPilot(user);
  const messagePreferences = useMessagePreferences(pilot ? user : null, convId ? "direct:" + convId : null);
  const visibleMessages = useMemo(() => msgs.filter(item => !messagePreferences.hidden.includes(String(item.id))), [msgs, messagePreferences.hidden]);
  const deletingChat = useRef(false);
  const deletionRevision = useRef(0);
  const shownGeneration = useRef(null);
  const peer = others.length === 1 ? others[0] : null;
  const onDeleteChat = () => {
    if (!convId || deletingChat.current || (pilot && !peer)) return;
    Alert.alert(pilot ? (lang === "en" ? "Delete this chat for both?" : "Eliminare la chat per entrambi?") : t("chat.deleteChat.title"),
      pilot ? (lang === "en"
        ? "Delete the history and its attachments from the gateway for both participants. A new message starts an empty chat. Copies saved or exported outside UNVOR stay on those devices."
        : "Elimina la cronologia e gli allegati dal gateway per entrambi. Un nuovo messaggio aprirà una chat vuota. Le copie salvate o esportate fuori da UNVOR restano sui dispositivi.")
        : t("chat.deleteChat.text"), [
      { text: t("cancel"), style: "cancel" },
      { text: pilot ? (lang === "en" ? "Delete for both" : "Elimina per entrambi") : t("delete"), style: "destructive", onPress: async () => {
        if (deletingChat.current) return;
        deletingChat.current = true;
        deletionRevision.current++;
        try {
          if (pilot) {
            await deletePilotChat(user, peer, convId);
            sendingRef.current = [];
            setMsgs([]);
            setText("");
            setReplyTo(null);
          } else await api.deleteConversation(convId);
          navigation.goBack();
        } catch (e) {
          const message = pilot && e?.response?.status === 404
            ? (lang === "en" ? "The gateway did not confirm permanent deletion." : "Il gateway non ha confermato l’eliminazione definitiva.")
            : api.apiErr(e);
          setErr(message);
        } finally { deletingChat.current = false; }
      } },
    ]);
  };

  const [trTarget, setTrTarget] = useState(null);
  const effTarget = trTarget || (lang === "en" ? "en" : "it");
  const onTranslate = async (item) => {
    if (!item?.body) return;
    const target = effTarget;
    try {
      const r = await api.translateWithConsent(item.body, target, lang === "en");
      if (!r) return;
      const detected = (r?.detected || "").toLowerCase();
      const sameLang = detected && detected === target.toLowerCase();
      setTranslations((m) => ({ ...m, [item.id]: { text: sameLang ? item.body : (r?.translated || ""), detected, show: true, same: sameLang, target } }));
    } catch (e) { setErr(api.apiErr(e)); }
  };
  const toggleTr = (id) => setTranslations((m) => ({ ...m, [id]: { ...m[id], show: !m[id].show } }));

  useEffect(() => { loadTranslateTarget().then(setTrTarget); }, []);

  const onMessageActions = (item) => setActionItem(item);
  const doReact = async (it, e) => { setActionItem(null); try { await api.pulseReact(it.id, e); await load(convId); } catch (err) { setErr(api.apiErr(err)); } };
  const doDelete = (it, scope) => {
    setActionItem(null);
    const all = scope === "all";
    Alert.alert(all ? t("chat.deleteForAll") : t("chat.deleteForMe"),
      lang === "en" ? "Remove this message from the conversation?" : "Rimuovere questo messaggio dalla conversazione?",
      [{ text: t("cancel"), style: "cancel" }, { text: t("delete"), style: "destructive", onPress: async () => {
        try {
          if (!pilot || it.serverBacked) await api.deleteMessage(it.id, scope);
          if (pilot) await messagePreferences.set("hidden", it.id, true);
          if (it.sendFailed) sendingRef.current = sendingRef.current.filter(row => row.id !== it.id);
          msgsSig.current = "";
          setMsgs(rows => rows.filter(row => row.id !== it.id));
          setReplyTo(reply => reply?.id === it.id ? null : reply);
          const poll=readPollPacket(it.body);
          if(poll?.kind==='create'&&peer)await forgetDirectPoll(user,peer,poll.id);
          if (convId) await load(convId);
        } catch (error) { setErr(api.apiErr(error)); }
      } }]);
  };
  const startEdit = (it) => { setActionItem(null); if (!it.mine || !it.body) return; setReplyTo(null); setEditing({ id: it.id }); setText(it.body); };
  const isPinned = it => pilot ? messagePreferences.pinned.includes(String(it.id)) : it.pinned;
  const doPin = async (it) => {
    setActionItem(null);
    try {
      if (pilot) await messagePreferences.set("pinned", it.id, !isPinned(it));
      else { await api.pinMessage(it.id, !it.pinned); await load(convId); }
    } catch (error) { setErr(api.apiErr(error)); }
  };
  const withMessageText = async (item, action) => {
    setActionItem(null);
    try { await action(readPollPacket(item.body)?.question || item.body); } catch (error) { setErr(api.apiErr(error)); }
  };
  const blockPeer = () => {
    setActionItem(null);
    if (!peer) return;
    Alert.alert(lang === "en" ? "Block contact?" : "Bloccare il contatto?", peer, [
      { text: t("cancel"), style: "cancel" },
      { text: lang === "en" ? "Block" : "Blocca", style: "destructive", onPress: async () => {
        try {
          await api.blockContact(peer, true);
          Alert.alert("UNVOR", lang === "en" ? "Contact blocked." : "Contatto bloccato.");
        } catch (error) { setErr(api.apiErr(error)); }
      } },
    ]);
  };
  const doReport = (it) => {
    setActionItem(null);
    Alert.alert(
      lang === "en" ? "Report message" : "Segnala messaggio",
      pilot ? (lang === "en" ? "Send only the message reference to the gateway?" : "Inviare al gateway solo il riferimento del messaggio?")
        : (lang === "en" ? "Report this message to moderators?" : "Segnalare questo messaggio ai moderatori?"),
      [{ text: t("cancel"), style: "cancel" }, { text: lang === "en" ? "Report" : "Segnala", style: "destructive", onPress: async () => { try { await api.reportMessage(it.id, ""); Alert.alert("OK", lang === "en" ? "Reported. Thank you." : "Segnalato. Grazie."); } catch (e) { setErr(api.apiErr(e)); } } }]
    );
  };

  // FINESTRA DEI MESSAGGI (caricamento pigro): all'apertura si decifrano e si disegnano solo
  // gli ultimi `INITIAL_WIN`; i più vecchi arrivano SOLO se l'utente li chiede scorrendo in
  // alto. Prima si costruiva l'intera cronologia ad ogni giro, anche di 4 secondi in 4.
  const load = useCallback(async (cid, limit, deepMode, preRaw, initialStatus) => {
    if (!cid) { setMsgs([]); setLoading(false); return; }
    if (deletingChat.current) return;
    if (hostedRatchetPilot(user) && !peer) { setLoading(false); return; }
    const revision = deletionRevision.current;
    const active = () => mounted.current && !deletingChat.current && revision === deletionRevision.current;
    try {
      // Si chiede UNA riga in più della finestra: se arriva, si sa che esiste cronologia
      // più vecchia (e si mostra "Messaggi precedenti") senza scaricarla.
      const want = (typeof limit === "number" ? limit : winRef.current);
      // `preRaw` = pagina già sul telefono: si disegna senza rete. Se la rete ha già
      // risposto la si scarta, per non tornare indietro nel tempo.
      const status = hostedRatchetPilot(user) && peer ? await (initialStatus || checkPilotChat(user, peer)) : null;
      if (status && active()) {
        const previous = shownGeneration.current;
        if (previous?.cid === cid && previous.generation > status.generation) return;
        if (previous?.cid === cid && previous.generation < status.generation) {
          sendingRef.current = [];
          setMsgs([]);
          setText("");
          setReplyTo(null);
          setEditing(null);
          setActionItem(null);
        }
        shownGeneration.current = { cid, generation: status.generation };
      }
      const rows = preRaw || await api.messages(cid, want + 1);
      if (!active()) return;
      const raw0 = status ? rows.filter(row => (row.generation || 0) === status.generation) : rows;
      if (preRaw) { if (netDone.current) return; } else { netDone.current = true; convCache.save(cid, raw0, user); }
      if (!preRaw && mounted.current) {
        const lastId = raw0[raw0.length - 1]?.message_id;
        const cursor = serverCursor.current;
        if (lastId && (cursor.cid !== cid || lastId > cursor.id)) {
          serverCursor.current = { cid, id: lastId };
          setServerHasMessages(true);
        }
      }
      const more = raw0.length > want;
      const raw = more ? raw0.slice(raw0.length - want) : raw0;
      setHasMore(more);
      const out = [];
      const contactChecks = new Map();
      const offline = !!preRaw && hostedRatchetPilot(user);
      const fast = typeof limit === "number";
      // `deepMode` separa le due cose che prima viaggiavano insieme: quanti messaggi
      // mostrare subito e se fare i tentativi a tentoni. La passata profonda ora gira
      // SOLO in sottofondo (vedi scheduleRepair), a interfaccia libera.
      const deep = deepMode === undefined ? !fast : !!deepMode;
      // La finestra vale SEMPRE, anche per la passata profonda: quella decide solo quanti
      // tentativi di chiave fare, non quanti messaggi disegnare.
      const window = fast ? limit : winRef.current;
      const from = Math.max(0, raw.length - window);
      let heavy = 0;
      let deferred = false;
      for (let mi = 0; mi < raw.length; mi++) {
        if (!active()) return;
        const m = raw[mi];
        if (mi < from) continue; // fuori finestra: si vedrà solo se l'utente scorre in alto
        let body = "🔒";
        let atts = [];
        let reply = null;
        let ttlv = 0;
        let signed = null;
        let groupInvite = null;
        if ((m.envelope || m.ratchet) && user?.kem) {
          // Riuso della decifratura già fatta (in memoria, non sul disco: nessun testo in
          // chiaro in più sul telefono). Prima si ri-decifrava tutta la conversazione ogni
          // 4 secondi, e uscendo dalla chat si ripartiva da zero.
          const e0 = (Array.isArray(m.envelopes) && m.envelopes[0]) || m.envelope || m;
          const ct = typeof e0 === "string" ? e0 : String(e0.ct || e0.c || "");
          const csig = m.ratchet
            ? sha256Hex(JSON.stringify([user.lns, m.mine, m.from_lns, m.to_lns, m.send_id, m.envelope]))
            : ct.length + ":" + ct.slice(-24);
          const hit = msgCache.get(cid, m.message_id);
          if (hit && hit.csig === csig && !(hit.soft && deep)) {
            if (hit.ctl) continue;
            body = hit.body; atts = hit.atts; reply = hit.reply; ttlv = hit.ttl; signed = hit.signed; groupInvite = hit.groupInvite;
          } else {
            // Ogni 5 decifrature si lascia respirare l'interfaccia.
            if (heavy && heavy % 5 === 0) await new Promise((r) => setTimeout(r, 0));
            heavy++;
            const pt = m.ratchet
              ? await readPilotMessage(m, user, { offline, contactChecks }).catch(() => null)
              : api.getServerUrl() === DEFAULT_SERVER
              ? decryptEnvelope(m.envelope, user.kem.secretKey)
              : await decryptAny(m, user, { deep, breathe: deep });
            if (pt == null) {
              if (offline && m.ratchet) continue;
              body = UNDEC;
              // Perché non si è aperta: forma delle buste, chiavi possedute, dispositivo.
              // Nessun contenuto, nessuna chiave: solo quello che serve a capire.
              try { decdiag.note(m, { dev: await myDeviceId(), pkIds: await localPrekeyIds() }); } catch { /* */ }
              // Catena rotta in un solo senso: se il messaggio è del ratchet e non si apre,
              // si chiede al mittente di ripartire da una radice nuova (una volta ogni 20
              // minuti). Senza questo lui continua per sempre con una catena che io non ho.
              try {
                const envs = Array.isArray(m.envelopes) ? m.envelopes : (m.envelope ? [m.envelope] : []);
                const rat = envs.find((e) => e && e.r && e.h && (!e.for || e.for === user.lns));
                if (rat && !m.ratchet && !m.mine && others.length === 1) {
                  await ratchetheal.requestReset(others[0], user, rat.h ? rat.h.sdev : "");
                }
              } catch { /* */ }
              // Esito negativo ricordato: senza questo si ritentava a ogni giro.
              if (!m.ratchet) msgCache.put(cid, m.message_id, { csig, body, atts: [], reply: null, ttl: 0, signed: null, soft: !deep });
              if (!deep) deferred = true;
            } else {
              const u = unpackMessage(pt); body = u.text; atts = u.atts; reply = u.reply; ttlv = u.ttl || 0;
              if (m.ratchet) groupInvite = u.groupInvite || null;
              if (u.sig && u.sig.s && u.sig.pk) signed = verifyMessage(body, u.sig.s, u.sig.pk);
              // Consegna di gettoni/chiavi per la cassetta anonima: non è un messaggio da mostrare.
              // Richiesta di ripartenza della catena: si azzera e si manda subito un
              // controllo che porta un init nuovo (invisibile per l'utente).
              if (typeof body === "string" && body.startsWith(ratchetheal.CTL_PREFIX)) {
                msgCache.put(cid, m.message_id, { csig, ctl: true });
                if (!m.mine && !hostedRatchetPilot(user)) { try { await ratchetheal.onReset(m.from_lns || "", user); } catch { /* */ } }
                continue;
              }
              // Identità mesh del contatto (chat sulla mesh): controllo invisibile.
              if (typeof body === "string" && body.startsWith(msh.CTL_PREFIX)) {
                msgCache.put(cid, m.message_id, { csig, ctl: true });
                continue;
              }
              if (typeof body === "string" && body.startsWith(mbx.CTL_PREFIX)) {
                msgCache.put(cid, m.message_id, { csig, ctl: true });
                if (!m.mine) { try { await mbx.onControl(body, m.from_lns || ""); } catch { /* */ } }
                continue;
              }
              // Qualsiasi ALTRO messaggio di controllo (anche di una versione futura) resta
              // invisibile: meglio niente che una riga di caratteri strani in chat.
              if (typeof body === "string" && body.charCodeAt(0) === 1) {
                msgCache.put(cid, m.message_id, { csig, ctl: true });
                continue;
              }
              msgCache.put(cid, m.message_id, { csig, body, atts, reply, ttl: ttlv, signed, groupInvite });
            }
          }
        }
        if (m.hidden === true) continue;
        out.push({ id: m.message_id, serverBacked: true, mine: !!m.mine, body, atts, reply, signed, groupInvite, reactions: Array.isArray(m.reactions) ? m.reactions : [], ttl: ttlv, at: m.sent_at || m.created_at, delivered: !!m.delivered, read: !!m.read, edited: !!m.edited, pinned: !!m.pinned });
      }
      // Messaggi arrivati per cassetta anonima: vivono solo qui, cifrati sul telefono.
      try {
        // Cassetta anonima: blob cifrato sul telefono. Si rilegge quando cambia, non 15
        // volte al minuto.
        if (anonRef.current.cid !== cid || anonRef.current.dirty) {
          // Cassetta anonima + messaggi arrivati (o in attesa) sulla mesh: entrambi vivono
          // solo qui, nel blob cifrato del telefono.
          const anonList = await mbx.localForConv(cid);
          const meshList = (await msh.localForConv(cid)).map((message) =>
            message.pending ? { ...message, pending: false, sendFailed: true } : message);
          anonRef.current = { cid, list: anonList.concat(meshList), dirty: false };
        }
        const anon = anonRef.current.list;
        if (anon.length) {
          out.push(...anon);
          out.sort((a, b) => String(a.at || "").localeCompare(String(b.at || "")));
        }
      } catch { /* modalità anonima non attiva */ }
      // Messaggi ripristinati da un backup cifrato: restano solo su questo telefono.
      try {
        // Archivio ripristinato da backup: immutabile mentre la chat è aperta.
        if (arcRef.current.cid !== cid) arcRef.current = { cid, list: await archiveForConv(cid) };
        const arc = arcRef.current.list;
        if (arc.length) {
          const have = new Set(out.map((m) => m.id));
          const add = arc.filter((m) => !have.has(m.id));
          if (add.length) {
            out.push(...add);
            out.sort((a, b) => String(a.at || "").localeCompare(String(b.at || "")));
          }
        }
      } catch { /* nessun archivio */ }
      // Messaggi appena inviati e ancora in viaggio: restano visibili.
      if (!active() || (preRaw && netDone.current) || (status && shownGeneration.current?.generation !== status.generation)) return;
      if (hostedRatchetPilot(user) && peer && (pollStateRef.current.polls.size || out.some(row=>readPollPacket(row.body)))) {
        const signature=out.map(row=>row.id+':'+(readPollPacket(row.body)?.op||'-')).join('|')+'#'+raw0.filter(row=>row.hidden).map(row=>row.message_id).join('|');
        if (pollSyncSignature.current!==signature) {
          const snapshot=await syncDirectPolls(user,peer,out,raw0.filter(row=>row.hidden).map(row=>row.message_id)).catch(error=>{if(active())setErr(api.apiErr(error));return null;});
          if (!active()) return;
          if(snapshot){
          pollSyncSignature.current=signature;
          pollStateRef.current=snapshot;
          setPollState(snapshot);
          }
        }
      }
      const visible = out.filter(row=>{const packet=readPollPacket(row.body);return !packet||packet.kind==='create';});
      out.splice(0,out.length,...visible);
      if (sendingRef.current.length) out.push(...sendingRef.current);
      pendingRef.current = deferred;
      // Stato del ratchet e chiavi: su disco una volta, non a ogni messaggio.
      flushBlobs().catch(() => {});
      if (mounted.current) {
        if (!preRaw && !deepMode && navigation.isFocused() && AppState.currentState === "active"
            && raw.some((message) => !message.mine && message.read === false)) {
          api.markRead(cid).then(refresh).catch(() => {});
        }
        // Se non è cambiato nulla non si ridisegna la chat: ogni setMsgs ricostruiva
        // l'intera lista dei messaggi.
        let vsig = out.length + "#";
        for (const mm of out) vsig += mm.id + (mm.delivered ? "d" : "") + (mm.read ? "r" : "") + (mm.edited ? "e" : "") + (mm.pinned ? "p" : "") + (mm.sendingLocal ? "s" : "") + (mm.sendFailed ? "!" : "") + (mm.pending ? "q" : "") + mm.reactions.length + "." + String(mm.body || "").length + "|";
        if (vsig !== msgsSig.current) { msgsSig.current = vsig; setMsgs(out); }
        setLoading(false);
        // Autodistruzione: pianifica una sola volta l'eliminazione dei messaggi con timer.
        for (const mm of out) {
          if (mm.ttl > 0 && !ephemRef.current.has(mm.id)) {
            ephemRef.current.add(mm.id);
            setTimeout(async () => {
              try { await api.deleteMessage(mm.id, mm.mine ? "all" : "me"); if (mounted.current) await load(cid); } catch { /* */ }
            }, mm.ttl * 1000);
          }
        }
      }
    } catch { if (mounted.current) setLoading(false); }
  }, [navigation, refresh, user, peer]);

  // Passata profonda (tentativi a tentoni sulle buste ancora chiuse): parte SOLO quando
  // l'utente non sta interagendo, una volta ogni 30 secondi al massimo, e non tocca il
  // percorso di apertura della chat.
  const repairRef = useRef(0);
  const scheduleRepair = useCallback((cid) => {
    if (!cid) return;
    const now = Date.now();
    if (now - repairRef.current < 30000) return;
    repairRef.current = now;
    InteractionManager.runAfterInteractions(() => {
      if (mounted.current) load(cid, undefined, true).catch(() => {});
    });
  }, [load]);

  useEffect(() => {
    mounted.current = true;
    winRef.current = INITIAL_WIN;
    setWin(INITIAL_WIN);
    atBottomRef.current = true;
    // Resolve participants/title when opened from a push (only conv_id known).
    if (convId && others.length === 0) {
      api.convs().then((list) => {
        const conv = (list || []).find((x) => x.conv_id === convId);
        if (conv && mounted.current) {
          setOthers(conv.others || (conv.title_lns ? [conv.title_lns] : []));
          setHeaderTitle(conv.title || (conv.title_lns || "Chat").split("@")[0]);
        }
      }).catch(() => {});
    }
    // CHAT ISTANTANEA: prima si disegna l'ultima pagina già presente sul telefono (buste
    // cifrate dentro un blob a sua volta cifrato con la chiave del dispositivo), senza
    // toccare la rete: con la linea lenta la chat non resta più vuota.
    netDone.current = false;
    let active = true;
    const initialStatus = convId && peer && hostedRatchetPilot(user) ? checkPilotChat(user, peer) : null;
    initialStatus?.catch(() => {});
    const loadNetwork = async () => {
      if (!active) return;
      await load(convId, INITIAL_WIN, undefined, undefined, initialStatus);
      if (active && pendingRef.current) scheduleRepair(convId);
    };
    const loadCached = async () => {
      const cached = await convCache.read(convId, user);
      if (active && cached && !netDone.current) await load(convId, INITIAL_WIN, false, cached, initialStatus);
    };
    loadCached().catch(() => {});
    loadNetwork();
    // Cassetta anonima: consegna i gettoni al contatto e ritira i depositi in arrivo.
    // Chiave statica del contatto in cassaforte: così la catena che si rigenera parte anche
    // se domani la richiesta al server non riesce.
    try { if (!hostedRatchetPilot(user)) require("../lib/maintenance").warmStaticKeys(others); } catch { /* */ }
    if (others.length === 1 && api.getServerUrl() !== DEFAULT_SERVER) {
      mbx.publishTo(others[0], user).catch(() => {});
    }
    return () => { active = false; mounted.current = false; };
  }, [convId, load, others, peer, user, scheduleRepair]);

  const sendPollEvent = async (packet) => {
    if (!(await maySendToContact())) throw new Error(lang==='en'?'Contact not accepted.':'Contatto non accettato.');
    try {
      const result=await sendChatMessage(packMessage(pollBody(packet),[],null,0),others,user);
      if(result?.conv_id&&result.conv_id!==convId)setConvId(result.conv_id);
      await load(result?.conv_id||convId);
    } catch(error){setErr(api.apiErr(error));throw error;}
  };
  const createPoll = async (form) => {
    if(pollSubmitBusy.current)return;
    pollSubmitBusy.current=true;
    setPollBusy(true);setErr("");
    try {
      const {packet,secret}=pollPrepared.current || makeDirectPoll(form);
      pollPrepared.current={packet,secret};
      if(secret)await saveDirectPollSecret(user,peer,packet,secret);
      await sendPollEvent(packet);
      setShowPollComposer(false);pollPrepared.current=null;
    }catch(error){setErr(api.apiErr(error));}
    finally{pollSubmitBusy.current=false;setPollBusy(false);}
  };
  useEffect(()=>{
    let active=true,retry;
    const reveal=async()=>{
      for(const packet of quizReveals(pollState)){
        if(!active||pollRevealing.current.has(packet.id))continue;
        pollRevealing.current.add(packet.id);
        try{await sendChatMessage(packMessage(pollBody(packet),[],null,0),others,user);if(active)await load(convId);}
        catch{if(active)retry=setTimeout(reveal,4000);}
        finally{pollRevealing.current.delete(packet.id);}
      }
    };
    if(peer&&hostedRatchetPilot(user))reveal();
    return()=>{active=false;clearTimeout(retry);};
  },[pollState,convId,user,peer,load,others]);

  // Aggiornamenti: solo con l'app in primo piano e questa chat davanti agli occhi.
  // Passata leggera: i messaggi già decifrati arrivano dalla memoria, i nuovi si decifrano
  // per la loro strada. Niente tentativi a tentoni qui: quelli vanno in sottofondo.
  useEffect(() => {
    registerHostedRatchet(user).catch(() => {});
  }, [user]);

  const hostedChat = api.getServerUrl() === DEFAULT_SERVER;
  const [live, setLive] = useState(false);
  useFocusEffect(useCallback(() => {
    if (!convId || !serverHasMessages || api.getServerUrl() !== DEFAULT_SERVER) return;
    let controller;
    let retry;
    let stopped = false;
    const stop = () => {
      controller?.abort();
      clearTimeout(retry);
    };
    const start = async (state) => {
      stop();
      if (stopped) return;
      setLive(false);
      if (state !== "active" || serverCursor.current.cid !== convId) return;
      const request = new AbortController();
      controller = request;
      let supported = true;
      try {
        while (!request.signal.aborted) {
          const before = serverCursor.current;
          if (before.cid !== convId || !before.id) break;
          const result = await api.messageEvents(convId, before.id, request.signal);
          if (request.signal.aborted) break;
          setLive(true);
          // Refresh on idle responses too, to pick up delivery and read receipts.
          await load(convId, winRef.current, false);
          if (result.changed && serverCursor.current.id === before.id) break;
        }
      } catch (error) {
        supported = ![404, 405].includes(error?.response?.status);
      } finally {
        if (!stopped && !request.signal.aborted) {
          setLive(false);
          if (supported) retry = setTimeout(() => start(AppState.currentState), 3000);
        }
      }
    };
    const sub = AppState.addEventListener("change", start);
    start(AppState.currentState);
    return () => { stopped = true; stop(); sub.remove(); };
  }, [convId, load, serverHasMessages]));

  usePoll(async () => {
    await load(convId, winRef.current, false);
    if (pendingRef.current) scheduleRepair(convId);
  }, 1000, { runOnFocus: false, active: !!convId && !live });
  usePoll(async () => {
    try { const r = await api.pulseTypingGet(convId); if (mounted.current) setTypers(Array.isArray(r?.typing) ? r.typing : []); } catch { /* */ }
    try { await api.presencePing(); } catch { /* */ }
  }, 4000, { runOnFocus: false, active: !!convId && !hostedChat });
  usePoll(async () => {
    if (await mbx.pickup(user) && mounted.current) {
      anonRef.current.dirty = true;
      await load(convId, winRef.current, false);
    }
  }, 15000, { runOnFocus: false, active: !!convId && !hostedChat });

  const maySendToContact = async ({ request = false } = {}) => {
    if (!pilot || others.length !== 1) return true;
    const peer = others[0];
    const relationship = await api.contactState(peer);
    if (relationship?.mutual) return true;
    const state = !relationship?.contact_request && request ? await api.addContact(peer) : relationship;
    if (state?.mutual) return true;
    const incoming = state?.contact_request === "incoming";
    setErr(incoming
      ? (lang === "en" ? "Accept this contact request in Contacts before sending." : "Accetta la richiesta in Rubrica per poter scrivere.")
      : state?.contact_request === "outgoing"
      ? (lang === "en" ? "Contact request sent. Your message stays a draft until they accept." : "Richiesta inviata. Il messaggio resta nella bozza finché il contatto accetta.")
      : (lang === "en" ? "An accepted contact is required to send attachments." : "Per inviare allegati serve un contatto accettato."));
    return false;
  };

  const onSend = async (override) => {
    if (deletingChat.current) return;
    if (draftDocuments.length) return sendDocumentsDraft();
    atBottomRef.current = true; // dopo un invio è giusto tornare in fondo
    const body = (typeof override === "string" ? override : text).trim();
    if (!body || others.length === 0 || !user?.kem) return;
    setSending(true); setErr("");
    try {
      if (!(await maySendToContact({ request: true }))) { setSending(false); return; }
    } catch (e) {
      setErr(api.apiErr(e)); setSending(false); return;
    }
    if (editing) {
      try {
        if (hostedRatchetPilot(user)) throw new Error("La modifica dei messaggi non è disponibile nella prova ratchet.");
        const payload = packMessage(body, [], null, ttl, null);
        const envelopes = await buildEnvelopes(payload, others, user);
        await api.editMessage(editing.id, envelopes);
        setText(""); setEditing(null);
        await load(convId);
      } catch (e) { setErr(api.apiErr(e)); }
      finally { setSending(false); }
      return;
    }
    // Invio ottimistico: il messaggio compare SUBITO, poi proseguono cifratura
    // post-quantistica e rete. Nessun passaggio crittografico viene saltato.
    const myReply = replyTo;
    const tmp = {
      id: "tmp-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7), mine: true, body,
      atts: [], reply: myReply, signed: null, reactions: [], ttl, at: new Date().toISOString(),
      delivered: false, read: false, edited: false, pinned: false, sendingLocal: true,
    };
    sendingRef.current = sendingRef.current.concat([tmp]);
    setMsgs((prev) => prev.concat([tmp]));
    setText(""); setReplyTo(null); setSending(false);
    const done = () => { sendingRef.current = sendingRef.current.filter((x) => x.id !== tmp.id); msgsSig.current = ""; };
    try {
      const payload = packMessage(body, [], myReply, ttl, null);
      const r = await sendChatMessage(payload, others, user);
      if (r?.conv_id && r.conv_id !== convId) setConvId(r.conv_id);
      done();
      await load(r?.conv_id || convId);
    } catch (e) {
      setErr(api.apiErr(e));
      const mark = (x) => (x.id === tmp.id ? Object.assign({}, x, { sendingLocal: false, sendFailed: true }) : x);
      sendingRef.current = sendingRef.current.map(mark);
      setMsgs((prev) => prev.map(mark));
    }
    finally { setUploadPct(null); }
  };

  // Cifra e invia un asset (foto o video) come allegato E2EE (blob + envelope).
  const sendAsset = async (asset) => {
    if (deletingChat.current) return;
    if (!asset?.uri || others.length === 0 || !user?.kem) return;
    try { if (!(await maySendToContact())) return; }
    catch (e) { setErr(api.apiErr(e)); return; }
    setSending(true); setErr("");
    try {
      const isVid = asset.type === "video" || (asset.mimeType || "").startsWith("video");
      // FOTO: si riduce sotto i 500 KB e si prepara la micro-anteprima. Una foto da 4 MB
      // impiegava un'eternità a partire e ad aprirsi; la cifratura non cambia di una virgola.
      const info = isVid ? await FileSystem.getInfoAsync(asset.uri) : null;
      const size = asset.fileSize || info?.size || 0;
      if (size > bigatt.MAX_ATT) throw new Error("File troppo grande (max 50 MB).");
      if (isVid && size > bigatt.ATT_CHUNK) {
        setUploadPct(0);
        const att = await bigatt.uploadFileChunked({
          uri: asset.uri, name: asset.fileName || `video_${Date.now()}.mp4`,
          mime: asset.mimeType || "video/mp4", size, allowed: others, onProgress: setUploadPct,
        });
        const res = await sendChatMessage(packMessage(text.trim(), [att], replyTo, ttl), others, user);
        setText(""); setReplyTo(null);
        if (res?.conv_id && res.conv_id !== convId) setConvId(res.conv_id);
        await load(res?.conv_id || convId);
        return;
      }
      let b64 = null;
      let prev = null;
      if (!isVid) {
        const small = await imageOpt.shrinkPhoto(asset.uri, 500 * 1024);
        if (small?.base64) b64 = small.base64;
        prev = await imageOpt.microPreview(small?.uri || asset.uri);
      }
      if (!b64) b64 = asset.base64 || await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.Base64 });
      const bytes = base64ToBytes(b64);
      const enc = await encryptFileBytesAsync(bytes);
      setUploadPct(0);
      const { id } = await api.blobUpload(enc.ciphertext, (p) => { if (mounted.current) setUploadPct(p); }, others);
      const att = {
        id,
        name: asset.fileName || `${isVid ? "video" : "foto"}_${Date.now()}.${isVid ? "mp4" : "jpg"}`,
        mime: isVid ? (asset.mimeType || "video/mp4") : "image/jpeg",
        size: bytes.length, key: enc.key, iv: enc.iv,
        // ~500 byte: viaggia dentro il messaggio cifrato, il server non la vede.
        prev: prev || undefined,
      };
      const payload = packMessage(text.trim(), [att], replyTo, ttl);
      const res = await sendChatMessage(payload, others, user);
      setText(""); setReplyTo(null);
      if (res?.conv_id && res.conv_id !== convId) setConvId(res.conv_id);
      await load(res?.conv_id || convId);
    } catch (e) { setErr(api.apiErr(e)); }
    finally { setSending(false); setUploadPct(null); }
  };

  // Registrazione nota vocale → cifra → blob → invia come allegato E2EE.
  const startRec = async () => {
    if (others.length === 0 || !user?.kem) { setErr(t("chat.attach.noconv")); return; }
    try { if (!(await maySendToContact())) return; }
    catch (e) { setErr(api.apiErr(e)); return; }
    suppressLock();
    try {
      const p = await AudioModule.requestRecordingPermissionsAsync();
      if (!p.granted) { setErr(lang === "en" ? "Microphone permission denied" : "Permesso microfono negato"); return; }
      await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
    } catch (e) { setErr(api.apiErr(e)); }
  };
  const cancelRec = async () => { try { await recorder.stop(); } catch { /* */ } };
  const stopRecAndSend = async () => {
    if (deletingChat.current) return;
    let uri;
    try { await recorder.stop(); uri = recorder.uri; } catch { /* */ }
    if (!uri) return;
    const dur = Math.round((recState.durationMillis || 0) / 1000);
    setSending(true); setErr("");
    try {
      const b64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
      const bytes = base64ToBytes(b64);
      const enc = await encryptFileBytesAsync(bytes);
      setUploadPct(0);
      const { id } = await api.blobUpload(enc.ciphertext, (p) => { if (mounted.current) setUploadPct(p); }, others);
      const att = { id, name: `vocale_${Date.now()}.m4a`, mime: "audio/m4a", size: bytes.length, key: enc.key, iv: enc.iv, kind: "voice", duration: dur };
      const payload = packMessage("", [att], replyTo, ttl);
      const res = await sendChatMessage(payload, others, user);
      setReplyTo(null);
      if (res?.conv_id && res.conv_id !== convId) setConvId(res.conv_id);
      await load(res?.conv_id || convId);
    } catch (e) { setErr(api.apiErr(e)); }
    finally { setSending(false); setUploadPct(null); }
  };

  const takePhoto = async () => {
    suppressLock();
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) { setErr(t("chat.attach.denied")); return; }
    const r = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.6, base64: true });
    if (!r.canceled && r.assets?.[0]) sendAsset(r.assets[0]);
  };
  const recordVideo = async () => {
    suppressLock();
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) { setErr(t("chat.attach.denied")); return; }
    const r = await ImagePicker.launchCameraAsync({ mediaTypes: ["videos"], quality: 0.5, videoMaxDuration: 90 });
    if (!r.canceled && r.assets?.[0]) sendAsset(r.assets[0]);
  };
  const pickMedia = async () => {
    try {
      const r = await withSystemActivity(() => ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images", "videos"], quality: 1 }));
      if (!r.canceled && r.assets?.[0]) sendAsset(r.assets[0]);
    } catch (e) { setErr(api.apiErr(e)); }
  };
  // File generico (documenti, qualsiasi tipo) via DocumentPicker, cifrato E2EE come gli altri allegati.
  const attachFile = async () => {
    if (deletingChat.current || documentFlow.current || sending) return;
    if (!others.length || !user?.kem) { setErr(t("chat.attach.noconv")); return; }
    documentFlow.current = true;
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: "*/*", copyToCacheDirectory: true, multiple: true });
      if (result.canceled) return;
      const selected = [...documentDraft.current];
      for (const asset of result.assets || []) {
        const size = asset.size ?? (await FileSystem.getInfoAsync(asset.uri)).size ?? 0;
        if (size < 1 || size > bigatt.MAX_ATT) {
          await discardDocuments([asset]);
          setErr(lang === "en" ? "Each file must be between 1 byte and 50 MB." : "Ogni file deve avere una dimensione fra 1 byte e 50 MB.");
          continue;
        }
        if (selected.length >= 10) { await discardDocuments([asset]); setErr(lang === "en" ? "Up to 10 files per message." : "Massimo 10 file per messaggio."); continue; }
        if (!selected.some(file => file.uri === asset.uri)) selected.push({ ...asset, size });
      }
      documentDraft.current = selected;
      setDraftDocuments(selected);
    } catch (error) { setErr(api.apiErr(error)); }
    finally { documentFlow.current = false; }
  };
  const removeDraftDocument = (uri) => {
    if (sending) return;
    const removed = documentDraft.current.filter(file => file.uri === uri);
    const kept = documentDraft.current.filter(file => file.uri !== uri);
    documentDraft.current = kept;
    setDraftDocuments(kept);
    discardDocuments(removed);
  };
  const sendDocumentsDraft = async () => {
    if (sending || documentUploads.current.size || !documentDraft.current.length || deletingChat.current) return;
    const files = [...documentDraft.current], caption = text.trim(), quote = replyTo;
    const check=api.authenticatedScope(user);
    const signature=sha256Hex(JSON.stringify([files.map(f=>[f.uri,f.size]),caption,quote,ttl]));
    setSending(true); setErr(""); setUploadPct(0);
    const operation = (async () => {
      if (!(await maySendToContact())) return;
      check();
      const attachments = documentPrepared.current?.signature===signature ? documentPrepared.current.attachments : [];
      for (let i=attachments.length;i<files.length;i++) {
        check();
        const asset=files[i], name=asset.name || `file_${Date.now()}`, mime=asset.mimeType || "application/octet-stream";
        const progress = fraction => { if (mounted.current) setUploadPct((i+fraction)/files.length); };
        let attachment;
        if (asset.size > bigatt.ATT_CHUNK) attachment = await bigatt.uploadFileChunked({uri:asset.uri,name,mime,size:asset.size,allowed:others,onProgress:progress});
        else {
          const bytes=base64ToBytes(await FileSystem.readAsStringAsync(asset.uri,{encoding:FileSystem.EncodingType.Base64}));
          const encrypted=await encryptFileBytesAsync(bytes);
          check();
          const uploaded=await api.blobUpload(encrypted.ciphertext,progress,others);
          attachment={id:uploaded.id,name,mime,size:bytes.length,key:encrypted.key,iv:encrypted.iv};
        }
        check();
        attachments.push(attachment);
        documentPrepared.current={signature,attachments:[...attachments]};
      }
      check();
      const result=await sendChatMessage(packMessage(caption,attachments,quote,ttl),others,user);
      documentDraft.current=[];documentPrepared.current=null;
      if (mounted.current) { setDraftDocuments([]); setText(""); setReplyTo(null); }
      await discardDocuments(files);
      if (result?.conv_id && result.conv_id !== convId) setConvId(result.conv_id);
      await load(result?.conv_id || convId);
    })();
    documentUploads.current.add(operation);
    try { await operation; }
    catch (error) { if (mounted.current) setErr(api.apiErr(error)); }
    finally { documentUploads.current.delete(operation); if (mounted.current) { setSending(false); setUploadPct(null); } }
  };
  // Apri/chiudi il menu allegati (stile identico ai gruppi).
  const toggleAttachMenu = () => {
    if (others.length === 0 || !user?.kem) { setErr(t("chat.attach.noconv")); return; }
    setShowAttachMenu((v) => {
      const next = !v;
      if (next) Keyboard.dismiss();
      return next;
    });
  };
  const runAttach = (fn) => { setShowAttachMenu(false); fn(); };

  const onChangeText = (t) => {
    const now = Date.now();
    if (!hostedChat && convId && now - typingRef.current > 2500) { typingRef.current = now; api.pulseTyping(convId).catch(() => {}); }
    setText(t);
  };

  // Messaggi precedenti: si allarga la finestra e si decifra SOLO il pezzo nuovo.
  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return;
    const now = Date.now();
    if (now - moreRef.current < 700) return;
    moreRef.current = now;
    setLoadingMore(true);
    atBottomRef.current = false;
    winRef.current = winRef.current + PAGE;
    setWin(winRef.current);
    try { await load(convId, winRef.current, false); } catch { /* si riprova */ }
    setLoadingMore(false);
    if (pendingRef.current) scheduleRepair(convId);
  }, [convId, load, loadingMore, hasMore, scheduleRepair]);

  // Stessa cura della lista delle conversazioni: la bolla si ridisegna solo quando cambia
  // qualcosa che la riguarda, non a ogni giro del poll.
  // Le buste che questo telefono non può aprire. Si ricavano da quello che è già a schermo:
  // nessuna interrogazione in più al server per contarle.
  const lockedIds = useMemo(() => msgs.filter((m) => m.body === UNDEC).map((m) => m.id).filter(Boolean), [msgs]);

  const purgeLocked = useCallback(async () => {
    if (!convId || !lockedIds.length || purging) return;
    setPurging(true); setErr("");
    try {
      await api.purgeMessages(convId, lockedIds.slice(0, 500));
      msgCache.clearAll();
      await load(convId, PAGE, false);
    } catch (e) { setErr(api.apiErr(e)); }
    setPurging(false);
  }, [convId, lockedIds, purging, load]);

  const hasDirectGroupInvite = pilot && msgs.some(item => !item.mine && item.groupInvite);
  const prepareGroupInvite = useCallback(async () => {
    invitePreparedAt.current = Date.now();
    try {
      await preparePilotGroupInvites(user);
      if (mounted.current) setInvitePrepFailed(false);
    } catch {
      if (mounted.current) setInvitePrepFailed(true);
    }
  }, [user]);
  const reloadGroupInvites = useCallback(async () => {
    const rows = await pilotInvitationInbox(user);
    const entries = await Promise.all(rows.map(async row => {
      // The MLS group validates signed member identities independently of 1:1 QR.
      // Link access is bound to the founder fingerprint in the invite URL.
      return [row.id, { ...row, needsQr: false }];
    }));
    if (mounted.current) setGroupInvites(Object.fromEntries(entries));
    if (rows.some(row => row.status === "accepted") && Date.now() - invitePreparedAt.current > 15000) {
      prepareGroupInvite();
    }
  }, [user, prepareGroupInvite]);
  useEffect(() => {
    setGroupInvites(null); setGroupInviteActions({}); setInvitePrepFailed(false);
  }, [peer, user?.lns, user?.server]);
  usePoll(reloadGroupInvites, 3500, { active: hasDirectGroupInvite });

  const actOnGroupInvite = useCallback(async (row, decision) => {
    if (inviteBusyRef.current) return;
    inviteBusyRef.current = true;
    setBusyInvite(row.id);
    setErr("");
    try {
      if (decision === "verify") await verifyPilotGroupAccount(user);
      else {
        await decidePilotGroupInvitation(user, row, decision);
        if (mounted.current) setGroupInviteActions(previous => ({ ...previous, [row.id]: decision }));
      }
      await reloadGroupInvites();
    } catch (error) {
      if (mounted.current) setErr(api.apiErr(error));
    } finally {
      inviteBusyRef.current = false;
      if (mounted.current) setBusyInvite(null);
    }
  }, [user, reloadGroupInvites]);

  const renderGroupInvite = useCallback(item => {
    if (item.mine || !item.groupInvite || !pilot) return null;
    const state = groupInvites?.[item.groupInvite.id];
    const row = state?.group === item.groupInvite.group ? state : null;
    const decision = groupInviteActions[item.groupInvite.id];
    const say = (it, en) => lang === "en" ? en : it;
    const action = (label, handler) => <TouchableOpacity accessibilityRole="button" disabled={!!busyInvite}
      style={styles.groupInviteButton} onPress={handler}><Text style={styles.groupInviteText}>{label}</Text></TouchableOpacity>;
    if (row?.status === "pending" && !decision) return <View style={styles.groupInviteActions}>
      {action(say("Accetta", "Accept"), () => actOnGroupInvite(row, "accepted"))}
      {action(say("Rifiuta", "Decline"), () => actOnGroupInvite(row, "declined"))}
    </View>;
    if (row?.status === "verification") return <View style={styles.groupInviteCard}>
      <Text style={styles.groupInviteText}>{say("Verifica l’account per entrare.", "Verify your account to join.")}</Text>
      {action(say("Verifica account", "Verify account"), () => actOnGroupInvite(row, "verify"))}
    </View>;
    if (row?.status === "accepted" && row.needsQr) return <View style={styles.groupInviteCard}>
      <Text style={styles.groupInviteText}>{say("Invito accettato. Verifica il QR del fondatore per aprire il gruppo.", "Invitation accepted. Verify the founder’s QR to open the group.")}</Text>
      {action(say("Verifica contatto", "Verify contact"), () => navigation.navigate("VerifyContact", {
        peer: row.inviter, peer_name: row.inviter,
      }))}
    </View>;
    if (row?.status === "accepted" && invitePrepFailed) return <View style={styles.groupInviteCard}>
      <Text style={styles.groupInviteText}>{say("Invito accettato. Preparazione delle chiavi in attesa.", "Invitation accepted. Waiting to prepare keys.")}</Text>
      {action(say("Riprova", "Retry"), prepareGroupInvite)}
    </View>;
    const label = row?.status === "accepted" || decision === "accepted" ?
      say("Invito accettato.", "Invitation accepted.") : decision === "declined" ?
      say("Invito rifiutato.", "Invitation declined.") : !groupInvites ?
      say("Caricamento invito…", "Loading invitation…") : say("Invito concluso o non disponibile.", "Invitation closed or unavailable.");
    return <Text style={styles.groupInviteText}>{label}</Text>;
  }, [pilot, groupInvites, groupInviteActions, lang, styles, busyInvite, actOnGroupInvite, navigation, invitePrepFailed, prepareGroupInvite]);

  const renderItem = useCallback(({ item, index }) => (
    <>
      {(index === 0 || dayKeyOf(item.at) !== dayKeyOf((visibleMessages[index - 1] || {}).at)) && (
        <View style={styles.dayRow} testID={"chat-day-" + dayKeyOf(item.at)}>
          <View style={styles.dayLine} />
          <Text style={styles.dayText}>{dayLabelOf(item.at, lang, t)}</Text>
          <View style={styles.dayLine} />
        </View>
      )}
    <TouchableOpacity
      activeOpacity={0.85}
      onLongPress={() => onMessageActions(item)}
      onLayout={(e) => { const h = e.nativeEvent.layout.height; if (h > 0) rowH.current.set(item.id, h); }}
      style={[styles.bubbleRow, item.mine ? styles.rowMine : styles.rowThem,
        !readPollPacket(item.body) && rowH.current.has(item.id) ? { minHeight: rowH.current.get(item.id) } : null]}
    >
      <View style={[styles.bubble, item.mine ? styles.bubbleMe : styles.bubbleThem,
        // Colore d'accento scelto dall'utente, applicato alla bolla dei propri messaggi.
        item.mine ? { backgroundColor: accent + "22", borderColor: accent + "59" } : null]}>
        {isPinned(item) && (<Text style={styles.pinnedTag} testID="msg-pinned">📌 {lang === "en" ? "Pinned" : "Fissato"}</Text>)}
        {item.reply && (
          <View style={styles.quote}>
            <Text style={styles.quoteName} numberOfLines={1}>{item.reply.name}</Text>
            <Text style={styles.quoteText} numberOfLines={2}>{item.reply.text || "📎"}</Text>
          </View>
        )}
        {readPollPacket(item.body)?.kind==='create' ? (pollState.polls.get(readPollPacket(item.body).id)
          ? <DirectPollCard poll={pollState.polls.get(readPollPacket(item.body).id)} onPacket={sendPollEvent} peerName={title} onProfile={()=>navigation.navigate("Profilo",{peer})}/>
          : <Text style={styles.bubbleText}>{readPollPacket(item.body).question}</Text>)
          : !!item.body && <SafeText text={item.body} style={styles.bubbleText} lang={lang} />}
        {renderGroupInvite(item)}
        {!!item.body && !readPollPacket(item.body) && <ThreatBanner result={analyzeMessage(item.body, lang)} lang={lang} />}
        {translations[item.id] && (
          <View style={styles.trBox} testID="msg-translated">
            <View style={styles.trRow}>
              <Text style={styles.trLabel}>🌐 {(translations[item.id].detected || "").toUpperCase()} → {((translations[item.id].target) || (lang === "en" ? "en" : "it")).toUpperCase()}</Text>
              <TouchableOpacity onPress={() => toggleTr(item.id)} testID="msg-translate-toggle">
                <Text style={styles.trToggle}>{translations[item.id].show ? (lang === "en" ? "See original" : "Vedi originale") : (lang === "en" ? "See translation" : "Vedi traduzione")}</Text>
              </TouchableOpacity>
            </View>
            {translations[item.id].show && <Text style={styles.trText}>{translations[item.id].text}</Text>}
          </View>
        )}
        {item.atts?.map((a, i) => <EncryptedAttachment key={a.id || i} att={a} />)}
        {item.reactions?.length > 0 && (
          <View style={styles.reactRow} testID="msg-reactions">
            {Object.entries(item.reactions.reduce((m, r) => { m[r.e] = (m[r.e] || 0) + 1; return m; }, {})).map(([e, n]) => (
              <View key={e} style={styles.reactChip}><Text style={styles.reactTxt}>{e}{n > 1 ? ` ${n}` : ""}</Text></View>
            ))}
          </View>
        )}
        {item.signed === true && (<Text style={styles.sigOk} testID="msg-signed">🔏 {lang === "en" ? "Signature verified · ML-DSA-65" : "Firma verificata · ML-DSA-65"}</Text>)}
        {item.signed === false && (<Text style={styles.sigBad}>🔏 {lang === "en" ? "invalid signature" : "firma non valida"}</Text>)}
        {item.ttl > 0 && (<Text style={styles.ttlTag}>⏱️ {item.ttl >= 3600 ? `${Math.round(item.ttl / 3600)}h` : item.ttl >= 60 ? `${Math.round(item.ttl / 60)}m` : `${item.ttl}s`}</Text>)}
        {item.edited && (<Text style={styles.editedTag} testID="msg-edited">{lang === "en" ? "edited" : "modificato"}</Text>)}
        <View style={styles.metaRow}>
          <Text style={styles.metaTime} testID="msg-time">{hhmm(item.at)}</Text>
          {item.mine && (
            <View style={styles.ticks} testID={item.read ? "tick-read" : item.delivered ? "tick-delivered" : "tick-sent"}>
              {item.sendFailed ? (
                <Text style={styles.sigBad}>{lang === "en" ? "Not sent" : "Non inviato"}</Text>
              ) : (
                <Ionicons
                  name={item.sendingLocal ? "time-outline" : item.delivered || item.read ? "checkmark-done" : "checkmark"}
                  size={15}
                  color={item.read ? theme.accent : "rgba(255,255,255,0.55)"}
                />
              )}
            </View>
          )}
        </View>
      </View>
    </TouchableOpacity>
    </>
  ), [styles, onMessageActions, accent, lang, translations, toggleTr, visibleMessages, messagePreferences.pinned, pilot, t, renderGroupInvite, pollState, peer, sendPollEvent]);

  return (
    <KeyboardAvoidingView behavior="padding" keyboardVerticalOffset={headerHeight} style={styles.root}>
      <EncryptionNotice kind="chat" />
      {vfy === "changed" && others.length === 1 && (
        <TouchableOpacity
          style={styles.vfyBar}
          testID="chat-verify-changed"
          onPress={() => navigation.navigate("VerifyContact", { peer: others[0], peer_name: title })}
        >
          <Ionicons name="warning-outline" size={13} color={theme.danger} />
          <Text style={styles.vfyBarTxt}>
            {lang === "en"
              ? "The keys of this contact changed — tap to verify again"
              : "Le chiavi di questo contatto sono cambiate — tocca per verificare di nuovo"}
          </Text>
        </TouchableOpacity>
      )}
      {loading ? (
        <View style={styles.center}><ActivityIndicator color={tint} /></View>
      ) : (
        <FlatList
          ref={listRef}
          style={{ flex: 1, backgroundColor: chatBg }}
          data={visibleMessages}
          keyExtractor={(m) => m.id}
          renderItem={renderItem}
          initialNumToRender={12}
          maxToRenderPerBatch={8}
          windowSize={7}
          updateCellsBatchingPeriod={80}
          // `removeClippedSubviews` NON si usa: su Android, con righe di altezza variabile,
          // capita che i messaggi appaiano vuoti. Con la finestra da 12 non serve.
          contentContainerStyle={{ padding: 14, paddingBottom: 20 }}
          // Aggiungendo messaggi in cima la lista resta ferma dov'è: senza questo la
          // cronologia più vecchia spingeva via quello che stavi leggendo.
          maintainVisibleContentPosition={{ minIndexForVisible: 1 }}
          onScroll={(e) => {
            const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
            atBottomRef.current = contentOffset.y + layoutMeasurement.height >= contentSize.height - 80;
            if (contentOffset.y <= 24 && hasMore) loadMore();
          }}
          scrollEventThrottle={160}
          onContentSizeChange={() => { if (atBottomRef.current) listRef.current?.scrollToEnd({ animated: false }); }}
          ListHeaderComponent={
            <View>
              {lockedIds.length > 0 && (
                <View style={{ marginHorizontal: 16, marginTop: 12, marginBottom: 4, borderWidth: 1, borderStyle: "dashed", borderColor: theme.border, borderRadius: 12, padding: 14 }} testID="chat-locked-note">
                  <Text style={{ color: theme.textDim, fontSize: 12, lineHeight: 18, textAlign: "center" }}>
                    {lang === "en"
                      ? `${lockedIds.length} envelope(s) encrypted for a key that no longer exists. Nobody can open them: not you, not the sender.`
                      : `${lockedIds.length} buste cifrate per una chiave che non esiste più. Non può aprirle nessuno: né tu né chi le ha mandate.`}
                  </Text>
                  <TouchableOpacity onPress={purgeLocked} disabled={purging} testID="chat-purge-locked"
                    style={{ marginTop: 12, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderWidth: 1, borderColor: "#ff4d5e66", borderRadius: 10, paddingVertical: 10, opacity: purging ? 0.5 : 1 }}>
                    {purging
                      ? <ActivityIndicator color="#ff9a9a" size="small" />
                      : <Ionicons name="trash-outline" size={16} color="#ff9a9a" />}
                    <Text style={{ color: "#ff9a9a", fontSize: 13, fontWeight: "700" }}>
                      {purging ? (lang === "en" ? "Deleting…" : "Cancellazione…") : (lang === "en" ? "Throw them away" : "Buttale via")}
                    </Text>
                  </TouchableOpacity>
                </View>
              )}
              {hasMore ? (
              <TouchableOpacity onPress={loadMore} style={styles.moreBtn} disabled={loadingMore} testID="chat-load-more">
                {loadingMore
                  ? <ActivityIndicator color={tint} />
                  : <Text style={styles.moreText}>{lang === "en" ? "Earlier messages" : "Messaggi precedenti"}</Text>}
                </TouchableOpacity>
              ) : null}
            </View>
          }
          keyboardShouldPersistTaps="always"
          keyboardDismissMode="none"
          ListEmptyComponent={
            <View style={styles.center}>
              <Text style={styles.emptyLock}>🔒</Text>
              <Text style={styles.emptyText}>{t("chat.placeholder")}</Text>
            </View>
          }
        />
      )}

      {!!err && <Text style={styles.err} testID="chat-error">{err}</Text>}

      {editing && (
        <View style={styles.replyBar} testID="chat-editing-bar">
          <View style={{ flex: 1 }}>
            <Text style={styles.replyBarName} numberOfLines={1}>✏️ {lang === "en" ? "Editing message" : "Modifica messaggio"}</Text>
            <Text style={styles.replyBarText} numberOfLines={1}>{lang === "en" ? "Send to save changes" : "Invia per salvare le modifiche"}</Text>
          </View>
          <TouchableOpacity onPress={() => { setEditing(null); setText(""); }} testID="chat-editing-cancel" hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="close-outline" size={20} color={theme.textDim} />
          </TouchableOpacity>
        </View>
      )}

      {replyTo && (
        <View style={styles.replyBar} testID="chat-reply-bar">
          <View style={{ flex: 1 }}>
            <Text style={styles.replyBarName} numberOfLines={1}>{t("chat.replyingTo")} {replyTo.name}</Text>
            <Text style={styles.replyBarText} numberOfLines={1}>{replyTo.text || "📎"}</Text>
          </View>
          <TouchableOpacity onPress={() => setReplyTo(null)} testID="chat-reply-cancel" hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Text style={{ color: theme.textDim, fontSize: 18 }}>✕</Text>
          </TouchableOpacity>
        </View>
      )}

      {typers.length > 0 && (
        <Text style={styles.typing} testID="chat-typing">✍️ {(typers[0] || "").split("@")[0]} {lang === "en" ? "is typing…" : "sta scrivendo…"}</Text>
      )}
      {uploadPct != null && (
        <View style={styles.uploadBar} testID="chat-upload-progress">
          <Ionicons name="cloud-upload-outline" size={16} color={tint} />
          <View style={styles.uploadTrack}>
            <View style={[styles.uploadFill, { width: `${Math.round(uploadPct * 100)}%` }]} />
          </View>
          <Text style={styles.uploadTxt} testID="chat-upload-pct">{Math.round(uploadPct * 100)}%</Text>
        </View>
      )}
      {!!draftDocuments.length && <View style={styles.documentsDraft} testID="chat-document-draft">
        <Text style={styles.draftTitle}>{lang === "en" ? "Ready to send" : "Pronti per l’invio"} · {draftDocuments.length}/10</Text>
        <ScrollView horizontal keyboardShouldPersistTaps="always" showsHorizontalScrollIndicator={false}>
          {draftDocuments.map(file => <View key={file.uri} style={styles.draftFile}>
            <Ionicons name="document-text-outline" size={23} color={tint} />
            <View style={{flex:1}}><Text numberOfLines={1} style={styles.draftFileName}>{file.name}</Text><Text style={styles.draftFileSize}>{(file.size/1024/1024).toFixed(2)} MB</Text></View>
            <TouchableOpacity onPress={()=>removeDraftDocument(file.uri)} disabled={sending} accessibilityLabel={lang === "en" ? "Remove file" : "Rimuovi file"}><Ionicons name="close-circle" size={22} color={theme.textDim}/></TouchableOpacity>
          </View>)}
        </ScrollView>
        <Text style={styles.draftHint}>{lang === "en" ? "Nothing is sent until you press Send." : "Nessun file viene inviato finché non premi Invia."}</Text>
      </View>}
      {showAttachMenu && <AttachmentSheet testID="chat-attach-menu" disabled={sending} limitLabel={t("attachment.limit")} items={[
        {id:"chat-attach-gallery",label:t("attachment.gallery"),icon:"images",color:"#24a9ff",action:()=>runAttach(pickMedia)},
        {id:"chat-attach-photo",label:t("attachment.camera"),icon:"camera",color:"#fb428b",action:()=>runAttach(takePhoto)},
        {id:"chat-attach-video",label:t("attachment.video"),icon:"videocam",color:"#22d5d8",action:()=>runAttach(recordVideo)},
        {id:"chat-attach-file",label:t("attachment.document"),icon:"document-text",color:"#a27aff",action:()=>runAttach(attachFile)},
        ...(pilot ? [{id:"chat-attach-poll",label:lang==='en'?'Poll':'Sondaggio',icon:"stats-chart",color:"#ffc666",action:()=>{setShowAttachMenu(false);setShowPollComposer(true);}}] : []),
      ]}/>}
      <View style={[styles.inputBar, { paddingBottom: keyboardVisible || emojiOpen ? 8 : Math.max(insets.bottom, 10) }]}>
        {recState.isRecording ? (
          <View style={styles.recRow} testID="chat-recording">
            <TouchableOpacity onPress={cancelRec} style={styles.recCancel} testID="rec-cancel"><Ionicons name="trash-outline" size={20} color="#FF6B7A" /></TouchableOpacity>
            <View style={styles.recDot} />
            <Text style={styles.recTime}>{mmss((recState.durationMillis || 0) / 1000)}</Text>
            <Text style={styles.recHint}>{lang === "en" ? "Recording…" : "Registrazione…"}</Text>
            <TouchableOpacity onPress={stopRecAndSend} style={styles.sendBtn} disabled={sending} testID="rec-send">
              {sending ? <ActivityIndicator color="#fff" size="small" /> : <Ionicons name="send-outline" size={18} color="#fff" />}
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <View style={styles.inputCapsule}>
            <TouchableOpacity style={styles.attachBtn} accessibilityLabel="Emoji" onPress={()=>{setShowAttachMenu(false);if(emojiOpen){setEmojiOpen(false);inputRef.current?.focus();}else{Keyboard.dismiss();setEmojiOpen(true);}}}><Ionicons name={emojiOpen?'keypad-outline':'happy-outline'} size={24} color={theme.textDim}/></TouchableOpacity>
            <TextInput
              ref={inputRef}
              style={styles.input}
              placeholder={t("chat.placeholder")}
              placeholderTextColor={theme.textFaint}
              value={text}
              editable={!sending}
              onChangeText={onChangeText}
              onFocus={() => {setShowAttachMenu(false);setEmojiOpen(false);}}
              onSelectionChange={event=>{inputSelection.current=event.nativeEvent.selection;}}
              selectionColor={tint}
              cursorColor={theme.text}
              keyboardAppearance="dark"
              returnKeyType="default"
              submitBehavior="newline"
              multiline
              testID="chat-input"
            />
            <TouchableOpacity style={styles.attachBtn} onPress={()=>{setEmojiOpen(false);toggleAttachMenu();}} disabled={sending} accessibilityRole="button" accessibilityLabel={lang === 'en'?'Attachments':'Allegati'} testID="chat-attach"><Ionicons name={showAttachMenu?'close-outline':'attach-outline'} size={25} color={showAttachMenu?tint:theme.textDim}/></TouchableOpacity>
            </View>
            {(text.trim() || draftDocuments.length) ? (
              <TouchableOpacity style={[styles.sendBtn, sending && { opacity: 0.5 }]} onPress={() => onSend()} disabled={sending} accessibilityRole="button" accessibilityLabel={lang === "en" ? "Send" : "Invia"} testID="chat-send">
                {sending ? <ActivityIndicator color="#fff" size="small" /> : <Ionicons name="send" size={22} color={theme.onAccent} />}
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={[styles.sendBtn, sending && { opacity: 0.5 }]} onPress={startRec} disabled={sending} accessibilityRole="button" accessibilityLabel={lang === "en" ? "Microphone" : "Microfono"} testID="chat-mic">
                <Ionicons name="mic-outline" size={20} color="#fff" />
              </TouchableOpacity>
            )}
          </>
        )}
      </View>
      {emojiOpen&&<View style={styles.emojiPanel} testID="chat-emoji-panel"><Text style={styles.draftTitle}>Emoji</Text><View style={styles.emojiGrid}>{emojiChoices.map(emoji=><TouchableOpacity key={emoji} style={styles.emojiChoice} onPress={()=>{const {start,end}=inputSelection.current;const before=text.slice(0,start),after=text.slice(end);setText(before+emoji+after);inputSelection.current={start:start+emoji.length,end:start+emoji.length};}}><Text style={{fontSize:27}}>{emoji}</Text></TouchableOpacity>)}</View></View>}
      {showPollComposer && <DirectPollComposer busy={pollBusy} prepared={!!pollPrepared.current} error={err} onClose={()=>{setShowPollComposer(false);pollPrepared.current=null;}} onCreate={createPoll} />}
      {actionItem && <ChatMessageMenu onClose={() => setActionItem(null)} actions={[
        { key: "chat-action-reply", label: t("chat.reply"), icon: "arrow-undo-outline", action: () => {
          const item = actionItem;
          setActionItem(null);
          setReplyTo({ id: item.id, name: item.mine ? (user?.lns?.split("@")[0] || "?") : title,
            text: (readPollPacket(item.body)?.question || item.body || "").slice(0, 140) });
        } },
        actionItem.body && { key: "chat-action-copy", label: lang === "en" ? "Copy" : "Copia", icon: "copy-outline",
          action: () => withMessageText(actionItem, copyMessageText) },
        actionItem.body && { key: "chat-action-share", label: lang === "en" ? "Share" : "Condividi", icon: "share-social-outline",
          action: () => withMessageText(actionItem, shareMessageText) },
        !pilot && actionItem.mine && actionItem.body && { key: "chat-action-edit", label: lang === "en" ? "Edit" : "Modifica",
          icon: "create-outline", action: () => startEdit(actionItem) },
        actionItem.body && { key: "chat-action-translate", label: (lang === "en" ? "Translate text" : "Traduci testo") +
          (detectLang(actionItem.body) ? "  " + langFlag(detectLang(actionItem.body)) : ""),
          icon: "language-outline", action: () => { const item = actionItem; setActionItem(null); onTranslate(item); } },
        { key: "chat-action-forward", label: lang === "en" ? "Forward" : "Inoltra", icon: "arrow-redo-outline",
          action: () => { const item = actionItem; setActionItem(null); navigation.navigate("Forward", { text: readPollPacket(item.body)?.question || item.body || "", atts: item.atts || [] }); } },
        !actionItem.sendingLocal && { key: "chat-action-pin", label: isPinned(actionItem)
          ? (lang === "en" ? "Unpin" : "Rimuovi da fissati") : (lang === "en" ? "Pin message" : "Fissa messaggio"),
          icon: isPinned(actionItem) ? "bookmark" : "bookmark-outline", action: () => doPin(actionItem) },
        !actionItem.mine && (!pilot || actionItem.serverBacked) && { key: "chat-action-report", label: lang === "en" ? "Report" : "Segnala",
          icon: "flag-outline", action: () => doReport(actionItem) },
        !actionItem.mine && peer && { key: "chat-action-block", label: lang === "en" ? "Block contact" : "Blocca contatto",
          icon: "ban-outline", danger: true, action: blockPeer },
        !actionItem.sendingLocal && { key: "chat-action-delete-me", label: t("chat.deleteForMe"),
          icon: "trash-outline", danger: true, action: () => doDelete(actionItem, "me") },
        actionItem.mine && !actionItem.sendingLocal && (!pilot || actionItem.serverBacked) &&
          { key: "chat-action-delete-all", label: t("chat.deleteForAll"), icon: "trash-outline", danger: true,
            action: () => doDelete(actionItem, "all") },
      ]}>
        {!pilot && <View style={styles.emojiRow}>
          {["👍", "❤️", "😂", "😮", "😢", "🙏"].map(em => (
            <TouchableOpacity key={em} style={styles.emojiBtn} testID={`chat-react-${em}`} onPress={() => doReact(actionItem, em)}>
              <Text style={styles.emojiText}>{em}</Text>
            </TouchableOpacity>
          ))}
        </View>}
      </ChatMessageMenu>}
    </KeyboardAvoidingView>
  );
}

const makeStyles = (tint) => StyleSheet.create({
  vfyBar: { flexDirection: "row", alignItems: "center", gap: 7, backgroundColor: "#2A1216", borderBottomWidth: 1, borderBottomColor: "#5A2630", paddingHorizontal: 14, paddingVertical: 8 },
  vfyBarTxt: { flex: 1, color: "#FFD9DE", fontSize: 11 },
  root: { flex: 1, backgroundColor: "transparent" },
  e2eeBadge: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, paddingVertical: 5, backgroundColor: theme.surface, borderBottomWidth: 1, borderBottomColor: theme.accentLine },
  e2eeBadgeText: { color: theme.accent, fontSize: 11, fontWeight: "700", letterSpacing: 0.8 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 40 },
  emptyLock: { fontSize: 40, marginBottom: 12 },
  emptyText: { color: theme.textDim, textAlign: "center", lineHeight: 20 },
  bubbleRow: { marginVertical: 4, flexDirection: "row" },
  rowMine: { justifyContent: "flex-end" },
  rowThem: { justifyContent: "flex-start" },
  bubble: { maxWidth: "80%", paddingHorizontal: 14, paddingVertical: 10, borderRadius: 14, borderWidth: 1, borderColor: theme.border },
  bubbleMe: { backgroundColor: theme.bubbleMe, borderBottomRightRadius: 5 },
  bubbleThem: { backgroundColor: theme.bubbleThem, borderBottomLeftRadius: 5 },
  bubbleText: { color: theme.text, fontSize: 15, lineHeight: 20 },
  attach: { color: "#D6E4FF", fontSize: 12, marginTop: 5 },
  groupInviteActions: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
  groupInviteCard: { gap: 6, marginTop: 4 },
  groupInviteButton: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, backgroundColor: theme.surface },
  groupInviteText: { color: theme.accent, fontSize: 13, fontWeight: "600" },
  quote: { borderLeftWidth: 3, borderLeftColor: "rgba(255,255,255,0.5)", paddingLeft: 8, marginBottom: 6, opacity: 0.9 },
  quoteName: { color: "#DCE7FF", fontSize: 12, fontWeight: "800" },
  quoteText: { color: "rgba(255,255,255,0.75)", fontSize: 13 },
  replyBar: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingVertical: 8, borderTopWidth: 1, borderTopColor: theme.border, backgroundColor: theme.surfaceAlt },
  replyBarName: { color: tint, fontSize: 12, fontWeight: "800" },
  replyBarText: { color: theme.textDim, fontSize: 13 },
  ticks: { flexDirection: "row", justifyContent: "flex-end", marginTop: 3, marginRight: -2 },
  attachBtn: { width: 42, height: 48, alignItems: "center", justifyContent: "center" },
  attachMenu: { flexDirection: "row", flexWrap: "wrap", gap: 6, padding: 8, backgroundColor: theme.surfaceAlt },
  attachItem: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, paddingHorizontal: 16 },
  attachItemText: { color: theme.text, fontSize: 15, fontWeight: "600" },
  attachIcon: { fontSize: 22 },
  moreBtn: { alignSelf: "center", paddingVertical: 10, paddingHorizontal: 18, marginBottom: 10, borderRadius: 999, borderWidth: 1, borderColor: "rgba(255,255,255,0.14)", minHeight: 40, justifyContent: "center" },
  moreText: { color: tint, fontSize: 12, fontWeight: "800", letterSpacing: 0.4 },
  err: { color: "#FFB3BD", fontSize: 13, paddingHorizontal: 16, paddingBottom: 6 },
  documentsDraft: {padding:12,gap:8,backgroundColor:theme.surfaceAlt,borderTopWidth:1,borderTopColor:theme.border},
  draftTitle: {color:theme.accent,fontSize:13,fontWeight:"700"},
  draftFile: {width:230,padding:10,marginRight:8,borderWidth:1,borderColor:theme.border,borderRadius:14,flexDirection:"row",alignItems:"center",gap:9},
  draftFileName: {color:theme.text,fontSize:13},
  draftFileSize: {color:theme.textDim,fontSize:11,marginTop:3},
  draftHint: {color:theme.textDim,fontSize:12},
  inputBar: { flexDirection: "row", alignItems: "flex-end", gap: 10, paddingHorizontal: 12, paddingVertical: 10, borderTopWidth: 1, borderTopColor: theme.border, backgroundColor: theme.surface },
  inputCapsule: {flex:1,flexDirection:"row",alignItems:"flex-end",minHeight:50,borderRadius:26,backgroundColor:theme.surfaceAlt,borderWidth:1,borderColor:theme.border},
  input: {flex:1,color:theme.text,paddingHorizontal:3,paddingTop:13,paddingBottom:13,minHeight:48,maxHeight:140,fontSize:16,lineHeight:22},
  emojiPanel: {padding:12,backgroundColor:theme.surfaceAlt,borderTopWidth:1,borderTopColor:theme.border,gap:10},
  emojiGrid: {flexDirection:"row",flexWrap:"wrap"},
  emojiChoice: {width:"14.28%",height:48,alignItems:"center",justifyContent:"center"},
  sendBtn: { width: 50, height: 50, borderRadius: 25, backgroundColor: tint, alignItems: "center", justifyContent: "center" },
  sendText: { color: theme.onAccent, fontSize: 22, fontWeight: "700" },
  ttlBtn: { flexDirection: "row", alignItems: "center", gap: 3, height: 44, paddingHorizontal: 8, borderRadius: 14 },
  ttlBtnOn: { backgroundColor: tint },
  ttlTxt: { color: theme.textDim, fontSize: 12, fontWeight: "800", minWidth: 16 },
  recRow: { flex: 1, flexDirection: "row", alignItems: "center", gap: 10 },
  recCancel: { width: 40, height: 44, alignItems: "center", justifyContent: "center" },
  recDot: { width: 11, height: 11, borderRadius: 6, backgroundColor: "#FF3B44" },
  recTime: { color: theme.text, fontSize: 15, fontWeight: "800", minWidth: 44 },
  recHint: { flex: 1, color: theme.textDim, fontSize: 13 },
  reactRow: { flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: 5 },
  emojiRow: { flexDirection: "row", justifyContent: "space-around", paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: theme.border, marginBottom: 6 },
  emojiBtn: { padding: 6 },
  emojiText: { fontSize: 28 },
  reactChip: { backgroundColor: "rgba(0,0,0,0.25)", borderRadius: 10, paddingHorizontal: 6, paddingVertical: 2 },
  reactTxt: { color: "#fff", fontSize: 13, fontWeight: "700" },
  ttlTag: { color: "rgba(255,255,255,0.6)", fontSize: 10, marginTop: 4, fontWeight: "700" },
  editedTag: { color: "rgba(255,255,255,0.5)", fontSize: 10, marginTop: 3, fontStyle: "italic" },
  dayRow: { flexDirection: "row", alignItems: "center", gap: 10, marginVertical: 10 },
  dayLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: theme.border },
  dayText: { color: theme.textDim, fontSize: 10.5, fontWeight: "700", letterSpacing: 1.2, textTransform: "uppercase" },
  metaRow: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 5, marginTop: 3 },
  metaTime: { color: theme.textDim, fontSize: 10.5 },
  pinnedTag: { color: theme.accent, fontSize: 10.5, fontWeight: "800", marginBottom: 4 },
  typing: { color: theme.textDim, fontSize: 12, fontStyle: "italic", paddingHorizontal: 16, paddingBottom: 4 },
  uploadBar: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingVertical: 8, borderTopWidth: 1, borderTopColor: theme.border, backgroundColor: theme.surfaceAlt },
  uploadTrack: { flex: 1, height: 6, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.12)", overflow: "hidden" },
  uploadFill: { height: 6, borderRadius: 3, backgroundColor: tint },
  uploadTxt: { color: tint, fontSize: 12, fontWeight: "800", minWidth: 38, textAlign: "right" },
  sigOk: { color: "#4fe0a5", fontSize: 10, marginTop: 4, fontWeight: "800" },
  sigBad: { color: "#ff9a9a", fontSize: 10, marginTop: 4, fontWeight: "800" },
  trBox: { marginTop: 6, paddingTop: 6, borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.15)" },
  trRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 2 },
  trToggle: { color: "#9ec5ff", fontSize: 10, fontWeight: "800" },
  trLabel: { color: "rgba(255,255,255,0.6)", fontSize: 10, fontWeight: "800", marginBottom: 2 },
  trText: { color: "#EAF2FF", fontSize: 14, lineHeight: 19, fontStyle: "italic" },
  langBadge: { flexDirection: "row", alignItems: "center", gap: 5, alignSelf: "flex-start", marginTop: 6, backgroundColor: "rgba(255,255,255,0.10)", borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 },
  langBadgeFlag: { fontSize: 13 },
  langBadgeCode: { color: "rgba(255,255,255,0.9)", fontSize: 10.5, fontWeight: "900", letterSpacing: 0.5 },
  langBadgeTap: { color: "#9ec5ff", fontSize: 10, fontWeight: "700" },
});
