import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { View, StyleSheet, TouchableOpacity, FlatList, ActivityIndicator, Keyboard, Alert } from "react-native";
import { Text, TextInput } from "../components/HudText";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useI18n } from "../lib/i18n";
import * as api from "../lib/api";
import { theme } from "../theme";
import Avatar from "../components/Avatar";
import { useAuth } from "../context/AuthContext";
import { unpackMessage } from "../lib/crypto";
import { decryptAny } from "../lib/devices";

import { hostedRatchetPilot, readPilotMessage } from "../lib/hostedRatchetChat";
import { hiddenMessageIds } from "../lib/chatMessageActions";
import { matchSearchContent } from "../lib/searchContent";
import { cachedPilotGroupDetails, cachedPilotGroupTitle, listPilotGroups, pilotGroupPolicy, presentPilotGroupHistory } from "../lib/pilotGroups";

export default function GlobalSearchScreen({ navigation }) {
  const { t, lang } = useI18n();
  const { user } = useAuth();
  const [q, setQ] = useState("");
  const [dq, setDq] = useState("");
  const [contacts, setContacts] = useState([]);
  const [groups, setGroups] = useState([]);
  const [msgHits, setMsgHits] = useState([]);
  const [msgBusy, setMsgBusy] = useState(false);
  const [msgDone, setMsgDone] = useState("");
  const [joining, setJoining] = useState("");
  const [loading, setLoading] = useState(true);
  const inputRef = useRef(null);
  const searchVersion = useRef(0);
  useEffect(() => () => { searchVersion.current++; }, [user]);
  const changeQuery = value => { searchVersion.current++; setQ(value); setMsgBusy(false); setMsgHits([]); setMsgDone(""); };

  useEffect(() => { const id = setTimeout(() => setDq(q), 120); return () => clearTimeout(id); }, [q]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const check = api.authenticatedScope(user);
      const c = await api.contacts().catch(() => []);
      check();
      if (!alive) return;
      setContacts(Array.isArray(c) ? c.map(row => typeof row === "string" ? { lns: row } : row).filter(row => row?.lns) : []);
      setLoading(false);
    })();
    const to = setTimeout(() => inputRef.current?.focus(), 350);
    return () => { alive = false; clearTimeout(to); };
  }, [user]);

  const sq = dq.trim().toLowerCase();
  const foundContacts = useMemo(() => (sq
    ? contacts.filter((c) => (c.lns || "").toLowerCase().includes(sq) || (c.display_name || "").toLowerCase().includes(sq) || (c.department || "").toLowerCase().includes(sq))
    : []), [contacts, sq]);

  const openChat = useCallback((c) => { Keyboard.dismiss(); navigation.replace("Chat", { conv_id: null, others: [c.lns], title: c.display_name || c.lns.split("@")[0], title_lns: c.lns }); }, [navigation]);

  // Group names are matched locally: the query never leaves the phone.
  useEffect(() => {
    let alive = true;
    if (!user || !hostedRatchetPilot(user)) { setGroups([]); return; }
    const check = api.authenticatedScope(user);
    listPilotGroups().then(async rows => {
      const result = [];
      for (const row of rows) {
        const name = await cachedPilotGroupTitle(user, row);
        check();
        result.push({ ...row, name: name || "Gruppo", chan_id: row.id, my_state: "member", pilot: true });
      }
      if (alive) setGroups(result);
    }).catch(() => { if (alive) setGroups([]); });
    return () => { alive = false; };
  }, [user]);
  const foundGroups = useMemo(() => sq ? groups.filter(g => (g.name || "").toLowerCase().includes(sq)) : [], [groups, sq]);

  const askJoin = useCallback((g) => {
    Alert.alert("Chiedi di entrare", `Inviare la richiesta di ingresso a «${g.name}»?\n\nGli amministratori del gruppo la vedranno e potranno accettarla.`, [
      { text: "Annulla", style: "cancel" },
      {
        text: "Invia richiesta",
        onPress: async () => {
          setJoining(g.chan_id);
          try {
            await api.groupJoinRequest(g.chan_id, "");
            setGroups((prev) => prev.map((x) => (x.chan_id === g.chan_id ? { ...x, my_state: "pending" } : x)));
            Alert.alert("Richiesta inviata", "Riceverai una notifica quando gli amministratori risponderanno.");
          } catch (e) { Alert.alert("Errore", api.apiErr ? api.apiErr(e) : "Richiesta non inviata"); }
          finally { setJoining(""); }
        },
      },
    ]);
  }, []);

  const openGroup = useCallback((g) => { Keyboard.dismiss(); g.pilot ? navigation.replace("PilotGroups", { group: g }) : navigation.replace("ChannelDetail", { chan_id: g.chan_id }); }, [navigation]);

  // Explicit search keeps typing fluid. Ratchet records are read in offline
  // mode: inspecting history cannot consume keys or initiate a new session.
  const searchMessages = useCallback(async () => {
    const term = q.trim();
    if (term.length < 2 || !user?.kem) return;
    const version = ++searchVersion.current;
    const scope = api.authenticatedScope(user);
    const active = () => { scope(); return version === searchVersion.current; };
    setMsgBusy(true); setMsgHits([]); setMsgDone("");
    const hits = [];
    let incomplete = false;
    try {
      const convs = await api.convs();
      for (const c of (convs || [])) {
        if (!active()) return;
        try {
          const hidden = new Set((await hiddenMessageIds(user, "direct:" + c.conv_id)).map(String));
          const raw = await api.messages(c.conv_id);
          if (!active()) return;
          for (const m of raw || []) {
            if (!active()) return;
            if (m.hidden || hidden.has(String(m.message_id)) || (!m.envelope && !m.ratchet)) continue;
            let pt;
            try { pt = m.ratchet ? await readPilotMessage(m, user, { offline: true }) : await decryptAny(m, user); }
            catch { continue; }
            if (!active()) return;
            if (pt == null) continue;
            const decoded = unpackMessage(pt);
            if (decoded.ttl > 0 || decoded.text?.charCodeAt(0) === 1) continue;
            const match = matchSearchContent(decoded.text, decoded.atts, term);
            if (match) hits.push({ id: c.conv_id + ":" + m.message_id, conv_id: c.conv_id,
              title: c.title || (c.title_lns || c.others?.[0] || "Chat").split("@")[0],
              others: c.others || (c.title_lns ? [c.title_lns] : []), ...match, mine: !!m.mine });
            if (hits.length >= 200) { incomplete = true; break; }
            await new Promise(resolve => setTimeout(resolve, 0));
          }
        } catch { incomplete = true; }
        if (hits.length >= 200) break;
      }
      for (const g of groups) {
        if (!active()) return;
        if (hits.length >= 200) { incomplete = true; break; }
        try {
          const policy = await pilotGroupPolicy(g);
          if (!policy) { incomplete = true; continue; }
          const details = await cachedPilotGroupDetails(user, g);
          if (!active()) return;
          if (!details?.members?.includes(user.lns)) continue;
          const hidden = new Set([...(policy?.hidden || []), ...await hiddenMessageIds(user, "group:" + g.id)].map(String));
          for (const item of presentPilotGroupHistory(details.history || [], user.lns)) {
            if (hidden.has(String(item.seq))) continue;
            const match = matchSearchContent(item.body, item.attachment ? [item.attachment] : [], term);
            if (match) hits.push({ id: g.id + ":" + item.seq, group: g, title: details.title || g.name, ...match, mine: item.sender === user.lns });
            if (hits.length >= 200) { incomplete = true; break; }
          }
        } catch { incomplete = true; }
      }
      if (!active()) return;
      setMsgHits(hits);
      setMsgDone(incomplete ? (lang === "en" ? "Partial search: some chats were unavailable or the 200-result limit was reached." : "Ricerca parziale: alcune chat non erano disponibili oppure sono stati raggiunti 200 risultati.") :
        hits.length ? "" : (lang === "en" ? "No result in the available history." : "Nessun risultato nella cronologia disponibile."));
    } catch {
      if (version === searchVersion.current) setMsgDone(lang === "en" ? "Search failed." : "Ricerca non riuscita.");
    } finally { if (version === searchVersion.current) setMsgBusy(false); }
  }, [q, user, lang, groups]);

  useEffect(() => { setMsgHits([]); setMsgDone(""); }, [dq]);

  const openMsg = useCallback((h) => {
    Keyboard.dismiss();
    if (h.group) { navigation.replace("PilotGroups", { group: h.group }); return; }
    navigation.replace("Chat", { conv_id: h.conv_id, others: h.others, title: h.title, title_lns: h.others[0] });
  }, [navigation]);

  const sections = [];
  if (foundContacts.length) sections.push({ type: "header", key: "h-c", label: t("search.colleagues") });
  foundContacts.forEach((c) => sections.push({ type: "contact", key: "c-" + c.lns, c }));
  if (foundGroups.length) sections.push({ type: "header", key: "h-g", label: lang === "en" ? "YOUR GROUPS" : "I TUOI GRUPPI" });
  foundGroups.forEach((g) => sections.push({ type: "group", key: "g-" + g.chan_id, g }));
  if (dq.trim().length >= 2) {
    sections.push({ type: "header", key: "h-msg", label: lang === "en" ? "MESSAGES" : "MESSAGGI" });
    sections.push({ type: "msgcta", key: "msg-cta" });
    msgHits.forEach((h) => sections.push({ type: "msg", key: "mh-" + h.id, h }));
  }

  const renderItem = ({ item }) => {
    if (item.type === "header") return <Text style={styles.sectionLabel}>{item.label}</Text>;
    if (item.type === "contact") {
      const c = item.c;
      return (
        <View style={styles.row} testID="search-contact-row">
          <Avatar seed={c.lns} label={c.display_name || c.lns} online={!!c.online} uri={c.avatar || undefined} />
          <View style={styles.info}>
            <Text style={styles.name} numberOfLines={1}>{c.display_name || c.lns.split("@")[0]}</Text>
            <Text style={styles.sub} numberOfLines={1}>{c.lns}{c.department ? "  ·  " + c.department : ""}</Text>
          </View>
          <TouchableOpacity style={[styles.action, { borderColor: theme.accent + "66" }]} onPress={() => openChat(c)} testID="search-chat-btn">
            <Ionicons name="chatbubble-ellipses-outline" size={17} color={theme.accent} />
          </TouchableOpacity>
        </View>
      );
    }
    if (item.type === "msgcta") {
      return (
        <TouchableOpacity style={styles.row} onPress={searchMessages} disabled={msgBusy} testID="search-messages-cta">
          <View style={styles.resultIcon}>
            {msgBusy ? <ActivityIndicator size="small" color={theme.primary} /> : <Ionicons name="chatbubbles-outline" size={18} color={theme.primary} />}
          </View>
          <View style={styles.info}>
            <Text style={styles.name}>
              {msgBusy ? (lang === "en" ? "Searching in chats…" : "Cerco nelle chat…") : (lang === "en" ? "Search messages and files" : "Cerca messaggi e file")}
            </Text>
            <Text style={styles.sub} numberOfLines={2}>
              {msgDone || (lang === "en" ? "Searches available chat and group history and filenames on this phone." : "Cerca nella cronologia disponibile di chat e gruppi e nei nomi dei file, sul telefono.")}
            </Text>
          </View>
        </TouchableOpacity>
      );
    }
    if (item.type === "msg") {
      const h = item.h;
      return (
        <TouchableOpacity style={styles.row} onPress={() => openMsg(h)} testID="search-message-row">
          <View style={styles.resultIcon}><Ionicons name="chatbubble-ellipses-outline" size={18} color={theme.accent} /></View>
          <View style={styles.info}>
            <Text style={styles.name} numberOfLines={1}>{h.title}</Text>
            <Text style={styles.sub} numberOfLines={2}>{(h.mine ? (lang === "en" ? "You: " : "Tu: ") : "") + h.text + (h.files?.length ? "\n📎 " + h.files.join(", ") : "")}</Text>
          </View>
        </TouchableOpacity>
      );
    }
    if (item.type === "group") {
      const g = item.g;
      const state = g.my_state || "none";
      return (
        <View style={styles.row} testID="search-group-row">
          <View style={styles.resultIcon}><Ionicons name="people-outline" size={18} color={theme.accent} /></View>
          <View style={styles.info}>
            <Text style={styles.name} numberOfLines={1}>{g.name}</Text>
            <Text style={styles.sub} numberOfLines={1}>
              {g.pilot ? (lang === "en" ? "Your group" : "Il tuo gruppo") : `${g.member_count} membri · admin ${g.owner_name || g.owner_lns}`}
            </Text>
          </View>
          {state === "member" ? (
            <TouchableOpacity style={[styles.action, { borderColor: theme.accent + "66" }]} onPress={() => openGroup(g)} testID="search-group-open">
              <Ionicons name="arrow-forward-outline" size={17} color={theme.accent} />
            </TouchableOpacity>
          ) : state === "pending" ? (
            <Text style={[styles.sub, { color: "#50C878", fontWeight: "700" }]} testID="search-group-pending">IN ATTESA</Text>
          ) : (
            <TouchableOpacity style={styles.joinBtn} onPress={() => askJoin(g)} disabled={joining === g.chan_id} testID="search-group-join">
              <Text style={styles.joinTxt}>{joining === g.chan_id ? "…" : "Chiedi di entrare"}</Text>
            </TouchableOpacity>
          )}
        </View>
      );
    }
    return null;
  };

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.searchBar}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={10} testID="search-back">
          <Ionicons name="arrow-back-outline" size={22} color={theme.text} />
        </TouchableOpacity>
        <Ionicons name="search-outline" size={18} color={theme.textFaint} />
        <TextInput
          ref={inputRef}
          style={styles.input}
          value={q}
          onChangeText={changeQuery}
          placeholder={lang === "en" ? "Messages, files, contacts, groups…" : "Messaggi, file, contatti, gruppi…"}
          placeholderTextColor={theme.textFaint}
          selectionColor={theme.primary}
          cursorColor={theme.text}
          keyboardAppearance="dark"
          underlineColorAndroid="transparent"
          autoCapitalize="none"
          autoCorrect={false}
          testID="global-search-input"
        />
        {q ? <TouchableOpacity onPress={() => changeQuery("")} hitSlop={10}><Ionicons name="close-outline" size={18} color={theme.textFaint} /></TouchableOpacity> : null}
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={theme.primary} /></View>
      ) : (
        <FlatList
          data={sections}
          keyExtractor={(i) => i.key}
          renderItem={renderItem}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="none"
          contentContainerStyle={sections.length === 0 ? { flexGrow: 1 } : { paddingBottom: 30 }}
          ListEmptyComponent={
            <View style={styles.center}>
              <Ionicons name="search-outline" size={34} color={theme.border} />
              <Text style={styles.hint}>{sq ? t("search.empty") : t("search.hint")}</Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "transparent" },
  searchBar: {
    flexDirection: "row", alignItems: "center", gap: 10, marginHorizontal: 14, marginTop: 8,
    backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, borderRadius: 12, paddingHorizontal: 12,
  },
  input: { flex: 1, color: theme.text, fontSize: 15, paddingVertical: 11 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, paddingHorizontal: 30 },
  hint: { color: theme.textFaint, fontSize: 14, textAlign: "center" },
  sectionLabel: { color: theme.textFaint, fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1, paddingHorizontal: 18, paddingTop: 18, paddingBottom: 6 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 11 },
  info: { flex: 1, minWidth: 0 },
  name: { color: theme.text, fontSize: 15, fontWeight: "600" },
  sub: { color: theme.textFaint, fontSize: 12, marginTop: 1 },
  action: { width: 38, height: 38, borderRadius: 10, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  resultIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: theme.primary + "1A", alignItems: "center", justifyContent: "center" },
  joinBtn: { borderWidth: 1, borderColor: theme.primary + "88", borderRadius: 20, paddingHorizontal: 12, paddingVertical: 7 },
  joinTxt: { color: theme.primary, fontSize: 12, fontWeight: "700" },
});
