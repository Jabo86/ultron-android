import React, { useEffect, useRef, useState } from "react";
import { FlatList, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import { useAuth } from "../context/AuthContext";
import { randomHex, sha256Hex } from "../lib/crypto";
import { getBlob, setBlobDurably } from "../lib/lock";
import { withSystemActivity } from "../lib/lockGuard";
import { usePoll } from "../lib/usePoll";
import { configureVolatileRelay } from "../lib/volatileRelayAndroid";
import { relayLabEngine, validateRelayLabProfile } from "../lib/volatileRelayLab";
import { theme } from "../theme";

const historyLimit = 64;
const labels = { local: "In attesa", pending: "In attesa", "awaiting-receipt": "Inviato", delivered: "Consegnato",
  blocked: "Invio bloccato" };

export default function VolatileRelayLabScreen() {
  const { user } = useAuth();
  const [profile, setProfile] = useState(null);
  const [rows, setRows] = useState([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const current = useRef(null);
  const loadingFile = useRef(false);
  const profileKey = "relay-lab-profile:" + sha256Hex(JSON.stringify([user?.server, user?.lns]));

  useEffect(() => {
    let active = true;
    getBlob(profileKey).then(value => {
      if (active && value) setProfile(validateRelayLabProfile(value, user?.lns));
    }).catch(() => { if (active) setError("Profilo pilota illeggibile."); });
    return () => { active = false; };
  }, [profileKey, user?.lns]);

  useEffect(() => {
    setReady(false);
    setRows([]);
    if (!profile || !user) return undefined;
    const key = profileKey + ":" + profile.pairing.id;
    let active = true;
    let relay, chat;
    let writes = Promise.resolve();
    const change = transform => {
      const write = writes.then(async () => {
        if (!active) throw new Error("Chat chiusa.");
        const old = await getBlob(key) ?? [];
        if (!active) throw new Error("Chat chiusa.");
        const next = transform(old);
        if (next !== old) await setBlobDurably(key, next);
        if (active) setRows(visible => [...next, ...visible.filter(row =>
          row.state === "local" && !next.some(item => item.id === row.id))]);
      });
      writes = write.catch(() => {});
      return write;
    };
    const add = row => change(old => {
      if (old.some(item => item.id === row.id && item.mine === row.mine)) return old;
      if (old.length >= historyLimit) throw new Error("Limite di messaggi del pilota raggiunto.");
      return [...old, row];
    });
    (async () => {
      const engine = await relayLabEngine(profile);
      if (!active) return;
      await change(old => old);
      relay = configureVolatileRelay(user, profile.registration, (id, state) => {
        change(old => old.map(row => row.id === id && row.mine ? { ...row, state } : row))
          .catch(() => { if (active) setError("Stato della consegna da aggiornare."); });
      });
      chat = relay.conversation({ engine, ...profile,
        receiveOnce: ({ id, payload }) => add({ id, text: payload, mine: false }),
      });
      const boot = await relay.admissionInfo();
      if (boot !== profile.grant.boot) throw new Error("Il relay è ripartito. Importa una nuova autorizzazione.");
      await relay.admit(profile.grant);
      if (!active) return;
      current.current = { chat, add };
      relay.outbox.resume();
      const saved = await getBlob(key) ?? [];
      for (const row of saved) {
        if (!active) return;
        if (row.mine && row.state === "local") await chat.send(row.id, row.text);
      }
      if (active) { setError(""); setReady(true); }
    })().catch(failure => {
      if (active) setError(failure.status === 403 || failure.status === 409
        ? "Autorizzazione rifiutata o scaduta. Importa un profilo aggiornato."
        : failure.message);
    });
    return () => {
      active = false;
      current.current = null;
      chat?.close();
      relay?.close();
    };
  }, [profile, profileKey, user]);

  usePoll(async () => {
    try { await current.current?.chat.poll(); setError(""); }
    catch (failure) { setError(failure.status === 401 ? "Sessione scaduta. Importa una nuova autorizzazione." : failure.message); }
  }, 1500, { active: ready });

  async function importProfile() {
    if (loadingFile.current) return;
    loadingFile.current = true;
    let uri;
    try {
      const file = await withSystemActivity(() => DocumentPicker.getDocumentAsync({ type: "application/json", copyToCacheDirectory: true }));
      if (file.canceled) return;
      const asset = file.assets[0];
      uri = asset.uri;
      const info = await FileSystem.getInfoAsync(uri);
      if (!info.exists || !Number.isSafeInteger(info.size) || info.size > 600000) throw new Error("File del pilota non valido.");
      const value = validateRelayLabProfile(JSON.parse(await FileSystem.readAsStringAsync(uri)), user?.lns);
      if (profile && (profile.pairing.id !== value.pairing.id ||
          profile.registration.token !== value.registration.token || profile.peer.publicKey !== value.peer.publicKey ||
          profile.mine.publicKey !== value.mine.publicKey || profile.registration.origin !== value.registration.origin)) {
        throw new Error("Questo file appartiene a un altro abbinamento.");
      }
      await setBlobDurably(profileKey, value);
      setProfile(value);
    } catch (failure) {
      setError(failure.message);
    } finally {
      if (uri?.startsWith(FileSystem.cacheDirectory ?? "\0")) {
        await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
      }
      loadingFile.current = false;
    }
  }

  function send() {
    const session = current.current;
    const text = draft.trim();
    if (!session || !text || !ready) return;
    const row = { id: randomHex(16), text, mine: true, state: "local" };
    setDraft("");
    setRows(items => [...items, row]);
    session.add(row).then(() => session.chat.send(row.id, text)).catch(failure => {
      setRows(items => items.map(item => item.id === row.id ? { ...item, state: "blocked" } : item));
      setError(failure.message);
    });
  }

  return <KeyboardAvoidingView behavior="padding" style={s.page}>
    <TouchableOpacity style={s.action} onPress={importProfile}>
      <Text style={s.text}>{profile ? "Aggiorna autorizzazione" : "Importa profilo pilota"}</Text>
    </TouchableOpacity>
    {!profile && <Text style={s.muted}>Usa un profilo di prova preparato per questo account.</Text>}
    {!!error && <Text accessibilityLiveRegion="polite" style={s.error}>{error}</Text>}
    <FlatList data={rows} keyExtractor={row => (row.mine ? "m:" : "r:") + row.id}
      contentContainerStyle={s.list} renderItem={({ item }) => <View style={[s.bubble, item.mine && s.mine]}>
        <Text style={s.text}>{item.text}</Text>
        {item.mine && <Text style={s.muted}>{labels[item.state]}</Text>}
      </View>} />
    <View style={s.composer}>
      <TextInput style={s.input} value={draft} onChangeText={setDraft} editable={ready} maxLength={2000}
        accessibilityLabel="Scrivi messaggio" placeholder="Scrivi messaggio" placeholderTextColor={theme.textDim} />
      <TouchableOpacity style={s.action} disabled={!ready || !draft.trim()} onPress={send}>
        <Text style={s.text}>Invia</Text>
      </TouchableOpacity>
    </View>
  </KeyboardAvoidingView>;
}
const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: theme.bg, padding: 12, gap: 8 },
  action: { backgroundColor: theme.surfaceAlt, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12 },
  list: { gap: 8 }, bubble: { alignSelf: "flex-start", maxWidth: "85%", padding: 12, borderRadius: 12, backgroundColor: theme.surfaceAlt },
  mine: { alignSelf: "flex-end", borderColor: theme.primary, borderWidth: 1 },
  text: { color: theme.text }, muted: { color: theme.textDim }, error: { color: "#ffb5bf" },
  composer: { flexDirection: "row", gap: 8, alignItems: "center" },
  input: { flex: 1, minHeight: 48, color: theme.text, borderColor: theme.border, borderWidth: 1, borderRadius: 12, padding: 10 },
});
