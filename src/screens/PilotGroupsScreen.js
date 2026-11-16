import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, AppState, FlatList, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../context/AuthContext";
import { useI18n } from "../lib/i18n";
import { apiErr } from "../lib/api";
import { cachedPilotGroupTitle, createPilotGroup, listPilotGroups, openPilotGroup, preparePilotGroupInvites, updatePilotGroup } from "../lib/pilotGroups";
import { theme } from "../theme";

export default function PilotGroupsScreen() {
  const { user } = useAuth();
  const { lang } = useI18n();
  const en = lang === "en";
  const say = (it, english) => en ? english : it;
  const [groups, setGroups] = useState([]);
  const [group, setGroup] = useState(null);
  const [details, setDetails] = useState(null);
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [member, setMember] = useState("");
  const [manage, setManage] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const alive = useRef(true);

  const refresh = useCallback(async (row) => {
    if (row) {
      const next = await openPilotGroup(user, row);
      if (alive.current) setDetails(next);
    } else {
      const rows = await listPilotGroups();
      const result = await Promise.all(rows.map(async item => ({...item, title: await cachedPilotGroupTitle(user, item)})));
      if (alive.current) setGroups(result);
    }
  }, [user]);

  async function run(task) {
    if (running.current) return;
    running.current = true;
    setBusy(true); setErr("");
    try { await task(); }
    catch (error) { if (alive.current) setErr(apiErr(error)); }
    finally { running.current = false; if (alive.current) setBusy(false); }
  }

  useEffect(() => {
    alive.current = true;
    if (user) run(async () => { await refresh(null); await preparePilotGroupInvites(user); });
    return () => { alive.current = false; };
  }, [user, refresh]);

  useEffect(() => {
    const tick = () => {
      if (running.current || AppState.currentState !== "active") return;
      running.current = true;
      refresh(group).catch(error => { if (alive.current) setErr(apiErr(error)); })
        .finally(() => { running.current = false; });
    };
    const timer = setInterval(tick, 3500);
    return () => clearInterval(timer);
  }, [group, refresh]);

  const open = (row) => run(async () => {
    setDetails(null); setGroup(row); setManage(false); setMessage(""); setMember("");
    await refresh(row);
  });
  const create = () => run(async () => {
    const title = name.trim();
    if (!title) return;
    const row = await createPilotGroup(user);
    setGroup(row); setDetails(null); setName("");
    setDetails(await updatePilotGroup(user, row, "title", title));
  });
  const send = () => run(async () => {
    const text = message.trim();
    if (!text) return;
    setDetails(await updatePilotGroup(user, group, "message", text));
    setMessage("");
  });
  const updateMember = (kind, account) => run(async () => {
    const address = account.trim().includes("@") ? account.trim() : account.trim() + "@ultron.uns";
    let next = await updatePilotGroup(user, group, kind, address);
    setDetails(next);
    setMember("");
    // Distribute only the group name after an Add; the prior messages stay in
    // the earlier epoch and aren't sent to the joining member.
    if (kind === "add" && next.title) {
      next = await updatePilotGroup(user, group, "title", next.title);
      setDetails(next);
    }
  });
  const goToList = () => run(async () => { setGroup(null); setDetails(null); setManage(false); await refresh(null); });

  const button = (label, onPress, { primary = false, disabled = busy } = {}) => (
    <TouchableOpacity onPress={onPress} disabled={disabled} accessibilityRole="button"
      style={[styles.button, primary && styles.primary, disabled && styles.disabled]}>
      <Text style={[styles.buttonText, primary && styles.primaryText]}>{label}</Text>
    </TouchableOpacity>
  );
  const warning = !!err && <Text style={styles.error} accessibilityLiveRegion="polite">{err}</Text>;
  const inputProps = { placeholderTextColor: theme.textDim, editable: !busy };
  if (!group) {
    return (
      <ScrollView style={styles.root} contentContainerStyle={styles.listPage} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>{say("Gruppi", "Groups")}</Text>
        {warning}
        {groups.map(row => (
          <TouchableOpacity key={row.id} onPress={() => open(row)} style={styles.row} disabled={busy} accessibilityRole="button">
            <Ionicons name="people-outline" color={theme.primary} size={22} />
            <View style={{flex: 1}}>
              <Text style={styles.text}>{row.title || `${say("Gruppo", "Group")} ${row.id.slice(0, 6)}`}</Text>
              <Text style={styles.dim}>{row.admin}</Text>
            </View>
            <Ionicons name="chevron-forward" color={theme.textDim} size={18} />
          </TouchableOpacity>
        ))}
        <View style={styles.card}>
          <Text style={styles.section}>{say("Crea un gruppo", "Create a group")}</Text>
          <TextInput {...inputProps} style={styles.input} value={name} maxLength={60} onChangeText={setName}
            placeholder={say("Nome del gruppo", "Group name")} accessibilityLabel={say("Nome del gruppo", "Group name")} />
          {button(say("Crea", "Create"), create, { primary: true, disabled: busy || !name.trim() })}
        </View>
        {busy && <ActivityIndicator color={theme.primary} />}
      </ScrollView>
    );
  }
  return (
    <View style={styles.root}>
      <View style={styles.header}>
        {button(say("Gruppi", "Groups"), goToList)}
        <Text style={styles.section} numberOfLines={1}>{details?.title || group.title || say("Gruppo", "Group")}</Text>
        {button(say("Membri", "Members"), () => setManage(value => !value))}
      </View>
      {warning}
      {manage ? <ScrollView contentContainerStyle={styles.listPage} keyboardShouldPersistTaps="handled">
        {(details?.members || []).map(account => (
          <View style={styles.row} key={account}>
            <Text style={[styles.text, {flex: 1}]}>{account}</Text>
            {group.admin === user.lns && account !== user.lns && button(say("Rimuovi", "Remove"), () => updateMember("remove", account))}
          </View>
        ))}
        {group.admin === user.lns && <View style={styles.card}>
          <Text style={styles.dim}>{say("I membri devono aprire Gruppi e verificare tra loro il nuovo QR ULTRON prima dell’invito.", "Members must open Groups and verify each other’s new ULTRON QR before the invitation.")}</Text>
          <TextInput {...inputProps} style={styles.input} value={member} onChangeText={setMember} autoCapitalize="none"
            autoCorrect={false} placeholder={say("Nome utente ULTRON", "ULTRON username")} accessibilityLabel={say("Nome utente ULTRON", "ULTRON username")} />
          {button(say("Aggiungi membro", "Add member"), () => updateMember("add", member), {primary: true, disabled: busy || !member.trim()})}
        </View>}
      </ScrollView> : <>
        <FlatList data={details?.history || []} keyExtractor={item => String(item.seq)} contentContainerStyle={styles.messages}
          renderItem={({item}) => <View style={styles.message}>
            <Text style={styles.dim}>{item.sender}</Text>
            <Text style={styles.text}>{item.body}</Text>
          </View>}
        />
        <View style={styles.composer}>
          <TextInput {...inputProps} style={[styles.input, styles.composeInput]} placeholder={say("Scrivi un messaggio", "Write a message")}
            accessibilityLabel={say("Scrivi un messaggio", "Write a message")} maxLength={2000} multiline value={message} onChangeText={setMessage} />
          {button(say("Invia", "Send"), send, {primary: true, disabled: busy || !details || !message.trim()})}
        </View>
      </>}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  listPage: { padding: 18, gap: 12, paddingBottom: 36 },
  header: { padding: 12, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  title: { color: theme.text, fontSize: 32, fontWeight: "800" },
  section: { color: theme.text, fontSize: 17, fontWeight: "700", flexShrink: 1 },
  text: { color: theme.text, fontSize: 15 },
  dim: { color: theme.textDim, fontSize: 13, lineHeight: 18 },
  error: { color: "#ffbbbb", padding: 12 },
  row: { minHeight: 56, padding: 12, flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 14,
    backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border },
  card: { padding: 16, gap: 12, borderRadius: 18, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border },
  input: { color: theme.text, paddingHorizontal: 12, paddingVertical: 10, minHeight: 44, borderWidth: 1,
    borderColor: theme.border, borderRadius: 12, backgroundColor: theme.surfaceAlt },
  button: { padding: 12, minHeight: 44, borderRadius: 12, justifyContent: "center", alignItems: "center",
    backgroundColor: theme.surfaceAlt },
  primary: { backgroundColor: theme.primary },
  disabled: { opacity: 0.45 },
  buttonText: { color: theme.text, fontSize: 14, fontWeight: "700" },
  primaryText: { color: "#04120a" },
  messages: { padding: 12, gap: 8 },
  message: { padding: 10, gap: 4, backgroundColor: theme.surfaceAlt, borderRadius: 14 },
  composer: { flexDirection: "row", alignItems: "flex-end", gap: 8, padding: 12 },
  composeInput: { flex: 1, maxHeight: 120 },
});
