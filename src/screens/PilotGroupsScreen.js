import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, AppState, FlatList, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../context/AuthContext";
import { useI18n } from "../lib/i18n";
import { useFocusEffect } from "@react-navigation/native";
import { apiErr, contacts } from "../lib/api";
import { contactAddress, matchesContact } from "../lib/contactAddress";
import { getVerified } from "../lib/verify";
import { cachedPilotGroupTitle, createPilotGroup, decidePilotGroupInvitation, listPilotGroups, listPublicPilotGroups, openPilotGroup,
  pilotGroupInvitations, pilotInvitationInbox, pilotInvitationTitle, preparePilotGroupInvites, presentPilotGroupHistory,
  requestPilotGroupInvitation, updatePilotGroup } from "../lib/pilotGroups";
import { theme } from "../theme";

export default function PilotGroupsScreen({ navigation, route }) {
  const { user } = useAuth();
  const { lang } = useI18n();
  const en = lang === "en";
  const say = (it, english) => en ? english : it;
  const [groups, setGroups] = useState([]);
  const [publicGroups, setPublicGroups] = useState([]);
  const [discover, setDiscover] = useState(false);
  const [visibility, setVisibility] = useState("private");
  const [inbox, setInbox] = useState([]);
  const [outgoing, setOutgoing] = useState([]);
  const triedInvites = useRef(new Set());
  const routedGroup = route?.params?.group || null;
  const [group, setGroup] = useState(routedGroup);
  const [details, setDetails] = useState(null);
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [pollEditor, setPollEditor] = useState(false);
  const [question, setQuestion] = useState("");
  const [choices, setChoices] = useState(["", ""]);
  const history = useMemo(() => presentPilotGroupHistory(details?.history || [], user?.lns), [details, user?.lns]);
  const [newGroup, setNewGroup] = useState(false);
  const [book, setBook] = useState([]);
  const [bookError, setBookError] = useState("");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState([]);
  const [loadingBook, setLoadingBook] = useState(false);
  const [manage, setManage] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const polling = useRef(false);
  const refreshVersion = useRef(0);
  const alive = useRef(true);

  const refresh = useCallback(async (row) => {
    const version = refreshVersion.current;
    const current = () => alive.current && version === refreshVersion.current;
    async function pendingFor() {
      if (row?.admin !== user.lns) return [];
      return pilotGroupInvitations(user, row).catch(error => {
        if (error?.response?.status === 404) return [];
        throw error;
      });
    }
    if (row) {
      let next = await openPilotGroup(user, row);
      if (current()) setDetails(next);
      let invitations = await pendingFor();
      let changed = false;
      for (const invitation of invitations) {
        if (!current()) return;
        if (invitation.status !== "accepted" || triedInvites.current.has(invitation.id)) continue;
        triedInvites.current.add(invitation.id);
        try {
          next = await updatePilotGroup(user, row, "add", invitation.target, invitation);
          changed = true;
          if (current()) setDetails(next);
        } catch (error) {
          if (current()) setErr(apiErr(error));
        }
      }
      if (changed) {
        invitations = await pendingFor();
        if (next.title) next = await updatePilotGroup(user, row, "title", next.title);
      }
      if (current()) { setOutgoing(invitations); setDetails(next); }
    } else {
      const rows = await listPilotGroups();
      const invitations = await pilotInvitationInbox(user).catch(error => {
        if (error?.response?.status === 404) return [];
        throw error;
      });
      const result = await Promise.all(rows.map(async item => ({ ...item, title: await cachedPilotGroupTitle(user, item) })));
      const incoming = await Promise.all(invitations.map(async item => ({ ...item, title: await pilotInvitationTitle(user, item) })));
      if (current()) { setGroups(result); setInbox(incoming); }
    }
  }, [user]);

  async function run(task) {
    if (running.current) return;
    running.current = true;
    refreshVersion.current++;
    setBusy(true); setErr("");
    try { await task(); }
    catch (error) { if (alive.current) setErr(apiErr(error)); }
    finally { running.current = false; if (alive.current) setBusy(false); }
  }

  useFocusEffect(useCallback(() => {
    let active = true;
    if (!user) return undefined;
    setLoadingBook(true);
    setBookError("");
    (async () => {
      const entries = await contacts();
      const eligible = entries.filter(entry => {
        const address = contactAddress(entry.lns);
        return address.endsWith("@ultron.uns") && address !== user.lns && entry.mutual === true && !entry.blocked;
      });
      const rows = await Promise.all(eligible.map(async entry => {
        const lns = contactAddress(entry.lns);
        const record = await getVerified(lns);
        return { ...entry, lns, legacyQr: !!record?.fp, verified: /^[a-f0-9]{64}$/.test(record?.identityFp || "") };
      }));
      if (active) {
        setBook(rows);
        const ready = new Set(rows.filter(row => row.verified).map(row => row.lns));
        setSelected(previous => previous.filter(address => ready.has(address)));
      }
    })().catch(error => { if (active) { setBook([]); setBookError(apiErr(error)); } })
      .finally(() => { if (active) setLoadingBook(false); });
    return () => { active = false; };
  }, [user]));

  useEffect(() => {
    alive.current = true;
    if (user) run(async () => { await refresh(routedGroup); await preparePilotGroupInvites(user); });
    return () => { alive.current = false; };
  }, [user, refresh, routedGroup]);

  useEffect(() => {
    const tick = () => {
      if (running.current || polling.current || !navigation.isFocused() || AppState.currentState !== "active") return;
      const version = refreshVersion.current;
      polling.current = true;
      refresh(group).catch(error => {
        if (alive.current && version === refreshVersion.current) setErr(apiErr(error));
      }).finally(() => { polling.current = false; });
    };
    const timer = setInterval(tick, 3500);
    return () => clearInterval(timer);
  }, [group, refresh, navigation]);

  const selectContact = (address) => setSelected(previous => previous.includes(address)
    ? previous.filter(value => value !== address) : [...previous, address]);

  const open = (row) => run(async () => {
    setDetails(null); setGroup(row); setManage(false); setMessage(""); setPollEditor(false); setQuery(""); setSelected([]);
    setOutgoing([]);
    await refresh(row);
  });

  async function invite(row, addresses) {
    const failures = [];
    for (const address of addresses) {
      try {
        await requestPilotGroupInvitation(user, row, address);
        setSelected(previous => previous.filter(item => item !== address));
      } catch (error) {
        const hint = error?.response?.status === 404
          ? say("Aggiorna il gateway per inviare inviti.", "Update the gateway to send invitations.")
          : apiErr(error);
        failures.push(`${address} · ${hint}`);
      }
    }
    await refresh(row);
    if (failures.length) setErr(failures.join("\n"));
  }

  const openDirectory = () => run(async () => {
    setPublicGroups(await listPublicPilotGroups(user));
    setDiscover(true);
  });

  const decide = (invitation, decision) => run(async () => {
    await decidePilotGroupInvitation(user, invitation, decision);
    await refresh(null);
  });
  const retryInvite = (invitation) => run(async () => {
    triedInvites.current.delete(invitation.id);
    await refresh(group);
  });


  const create = () => run(async () => {
    const title = name.trim();
    if (!title) return;
    const row = await createPilotGroup(user, title, visibility);
    setGroup(row); setDetails(null); setManage(true); setNewGroup(false); setName(""); setQuery("");
    const initial = await updatePilotGroup(user, row, "title", row.title || title);
    setDetails(initial);
    if (selected.length) await invite(row, selected);
  });
  const send = () => run(async () => {
    const text = message.trim();
    if (!text) return;
    setDetails(await updatePilotGroup(user, group, "message", text));
    setMessage("");
  });
  const createPoll = () => run(async () => {
    setDetails(await updatePilotGroup(user, group, "poll", { question, options: choices }));
    setPollEditor(false); setQuestion(""); setChoices(["", ""]);
  });
  const vote = (id, choice) => run(async () => {
    setDetails(await updatePilotGroup(user, group, "vote", { id, choice }));
  });
  const remove = (address) => run(async () => {
    setDetails(await updatePilotGroup(user, group, "remove", address));
  });
  const goToList = () => {
    if (routedGroup) { navigation.goBack(); return; }
    run(async () => {
      setGroup(null); setDetails(null); setManage(false); setQuery(""); setSelected([]);
      await refresh(null);
    });
  };

  const openProfile = (peer) => navigation.navigate("Profilo", { peer });

  const button = (label, onPress, { primary = false, disabled = busy } = {}) => (
    <TouchableOpacity onPress={onPress} disabled={disabled} accessibilityRole="button"
      style={[styles.button, primary && styles.primary, disabled && styles.disabled]}>
      <Text style={[styles.buttonText, primary && styles.primaryText]}>{label}</Text>
    </TouchableOpacity>
  );
  const warning = !!err && <Text style={styles.error} accessibilityLiveRegion="polite">{err}</Text>;
  const inputProps = { placeholderTextColor: theme.textDim, editable: !busy };
  const contactPicker = () => {
    const present = new Set([...(details?.members || []), ...outgoing.filter(item => item.status !== "declined").map(item => item.target)]);
    const available = book.filter(row => !present.has(row.lns) && matchesContact(row, query));
    return (
      <View style={styles.picker}>
        <Text style={styles.section}>{say("Scegli dalla rubrica", "Choose from contacts")}</Text>
        <TextInput {...inputProps} style={styles.input} value={query} onChangeText={setQuery} autoCapitalize="none"
          autoCorrect={false} placeholder={say("Cerca contatto", "Search contacts")} accessibilityLabel={say("Cerca contatto", "Search contacts")} />
        {loadingBook && <ActivityIndicator color={theme.primary} />}
        {!!bookError && <Text style={styles.error}>{bookError}</Text>}
        {!loadingBook && !bookError && !available.length && <Text style={styles.dim}>{say("Nessun contatto disponibile.", "No contacts available.")}</Text>}
        {available.map(row => {
          const checked = selected.includes(row.lns);
          const label = row.display_name || row.lns.split("@")[0];
          return row.verified ? (
            <TouchableOpacity key={row.lns} style={[styles.row, checked && styles.selected]} onPress={() => selectContact(row.lns)}
              disabled={busy} accessibilityRole="checkbox" accessibilityState={{ checked }} accessibilityLabel={label}>
              <Ionicons name={checked ? "checkbox" : "square-outline"} size={22} color={theme.primary} />
              <View style={{ flex: 1 }}><Text style={styles.text}>{label}</Text><Text style={styles.dim}>{row.lns}</Text></View>
            </TouchableOpacity>
          ) : (
            <View key={row.lns} style={styles.row}>
              <View style={{ flex: 1 }}><Text style={styles.text}>{label}</Text><Text style={styles.dim}>{row.lns}</Text></View>
              {button(row.legacyQr ? say("Aggiorna QR", "Update QR") : say("Verifica QR", "Verify QR"), () => navigation.navigate("VerifyContact", { peer: row.lns, peer_name: label }))}
            </View>
          );
        })}
      </View>
    );
  };
  if (discover && !group) return (
    <ScrollView style={styles.root} contentContainerStyle={styles.listPage}>
      {button(say("Torna ai gruppi", "Back to groups"), () => setDiscover(false))}
      <Text style={styles.title}>{say("Gruppi pubblici", "Public groups")}</Text>
      <Text style={styles.dim}>{say("Per entrare serve un invito e il QR ULTRON verificato.", "Entry requires an invitation and a verified ULTRON QR.")}</Text>
      {publicGroups.map(item => (
        <TouchableOpacity key={item.id} style={styles.row} onPress={() => openProfile(item.admin)} accessibilityRole="button">
          <View style={{ flex: 1 }}><Text style={styles.text}>{item.name}</Text><Text style={styles.dim}>{item.admin}</Text></View>
          <Ionicons name="person-outline" size={20} color={theme.textDim} />
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
  if (!group) {
    return (
      <ScrollView style={styles.root} contentContainerStyle={styles.listPage} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>{say("Gruppi", "Groups")}</Text>
        {warning}
        {inbox.map(invitation => (
          <View key={invitation.id} style={styles.card}>
            <Text style={styles.section}>{invitation.title || say("Invito al gruppo", "Group invitation")}</Text>
            <TouchableOpacity onPress={() => openProfile(invitation.inviter)} accessibilityRole="button">
              <Text style={styles.sender}>{invitation.inviter}</Text>
            </TouchableOpacity>
            {invitation.status === "pending" ? <View style={styles.actions}>
              {button(say("Accetta", "Accept"), () => decide(invitation, "accepted"), { primary: true })}
              {button(say("Rifiuta", "Decline"), () => decide(invitation, "declined"))}
            </View> : <Text style={styles.dim}>{say("Accettato. L’ingresso si completa quando l’amministratore apre il gruppo.", "Accepted. Entry completes when the administrator opens the group.")}</Text>}
          </View>
        ))}
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
        {button(say("Esplora gruppi pubblici", "Explore public groups"), openDirectory)}
        {newGroup ? <View style={styles.card}>
          <Text style={styles.section}>{say("Nuovo gruppo", "New group")}</Text>
          <TextInput {...inputProps} style={styles.input} value={name} maxLength={60} onChangeText={setName}
            placeholder={say("Nome del gruppo", "Group name")} accessibilityLabel={say("Nome del gruppo", "Group name")} />
          <View style={styles.actions}>
            {button(say("Privato", "Private"), () => setVisibility("private"), { primary: visibility === "private" })}
            {button(say("Pubblico", "Public"), () => setVisibility("public"), { primary: visibility === "public" })}
          </View>
          {visibility === "public" && <Text style={styles.dim}>{say("Nome e amministratore compaiono nell’elenco pubblico. Si entra su invito.", "The name and administrator appear in the public directory. Entry is by invitation.")}</Text>}
          {contactPicker()}
          {button(say("Crea gruppo", "Create group"), create, { primary: true, disabled: busy || !name.trim() })}
          {button(say("Annulla", "Cancel"), () => { setNewGroup(false); setName(""); setQuery(""); setSelected([]); })}
        </View> : button(say("Nuovo gruppo", "New group"), () => setNewGroup(true), { primary: true })}
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
            <TouchableOpacity onPress={() => openProfile(account)} accessibilityRole="button" style={{ flex: 1, paddingVertical: 6 }}>
              <Text style={styles.text}>{account}</Text>
            </TouchableOpacity>
            {group.admin === user.lns && account !== user.lns && button(say("Rimuovi", "Remove"), () => remove(account))}
          </View>
        ))}
        {group.admin === user.lns && <View style={styles.card}>
          {outgoing.map(invitation => (
            <View key={invitation.id} style={styles.row}>
              <Text style={[styles.dim, { flex: 1 }]}>{invitation.target} · {invitation.status === "declined"
                ? say("Rifiutato", "Declined") : invitation.status === "accepted" ? say("Accettato", "Accepted") : say("In attesa", "Pending")}</Text>
              {invitation.status === "accepted" && button(say("Completa ingresso", "Complete entry"), () => retryInvite(invitation))}
            </View>
          ))}
          {contactPicker()}
          {button(say("Invia inviti", "Send invitations"), () => run(() => invite(group, selected)),
            {primary: true, disabled: busy || !details || !selected.length})}
        </View>}
      </ScrollView> : <>
        <FlatList data={history} keyExtractor={item => String(item.seq)} contentContainerStyle={styles.messages}
          renderItem={({item}) => <View style={styles.message}>
            <TouchableOpacity onPress={() => openProfile(item.sender)} accessibilityRole="button">
              <Text style={styles.sender}>{item.sender}</Text>
            </TouchableOpacity>
            <Text style={styles.text}>{item.body}</Text>
            {item.poll?.kind === "poll" && <View style={styles.poll}>
              {item.poll.options.map((option, index) => (
                <TouchableOpacity key={option} accessibilityRole="button" accessibilityState={{ disabled: busy, selected: index === item.choice }}
                  disabled={busy} onPress={() => vote(item.poll.id, index)} style={[styles.row, index === item.choice && styles.selected]}>
                  <Text style={[styles.text, { flex: 1 }]}>{option}</Text>
                  <Text style={styles.dim}>{item.totals[index]}</Text>
                </TouchableOpacity>
              ))}
            </View>}
          </View>}
        />
        {pollEditor && <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 260 }} contentContainerStyle={styles.pollEditor}>
          <TextInput {...inputProps} style={styles.input} placeholder={say("Domanda", "Question")}
            accessibilityLabel={say("Domanda", "Question")} maxLength={140} value={question} onChangeText={setQuestion} />
          {choices.map((choice, index) => <TextInput key={index} {...inputProps} style={styles.input}
            placeholder={say("Opzione", "Option") + " " + (index + 1)}
            accessibilityLabel={say("Opzione", "Option") + " " + (index + 1)} value={choice} maxLength={80}
            onChangeText={text => setChoices(previous => previous.map((value, i) => i === index ? text : value))} />)}
          <View style={styles.actions}>
            {button(say("Annulla", "Cancel"), () => setPollEditor(false))}
            {choices.length < 6 && button(say("Aggiungi opzione", "Add option"), () => setChoices(value => [...value, ""]))}
            {button(say("Pubblica", "Post"), createPoll, { primary: true,
              disabled: busy || !question.trim() || choices.some(choice => !choice.trim()) ||
                new Set(choices.map(choice => choice.trim())).size !== choices.length })}
          </View>
        </ScrollView>}
        <View style={styles.composer}>
          {button(say("Sondaggio", "Poll"), () => setPollEditor(value => !value), { disabled: busy || !details })}
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
  actions: { flexDirection: "row", gap: 8 },
  picker: { gap: 8 },
  selected: { borderColor: theme.primary },
  input: { color: theme.text, paddingHorizontal: 12, paddingVertical: 10, minHeight: 44, borderWidth: 1,
    borderColor: theme.border, borderRadius: 12, backgroundColor: theme.surfaceAlt },
  button: { padding: 12, minHeight: 44, borderRadius: 12, justifyContent: "center", alignItems: "center",
    backgroundColor: theme.surfaceAlt },
  primary: { backgroundColor: theme.primary },
  disabled: { opacity: 0.45 },
  buttonText: { color: theme.text, fontSize: 14, fontWeight: "700" },
  primaryText: { color: "#04120a" },
  messages: { padding: 12, gap: 8 },
  sender: { color: theme.primary, fontSize: 13, fontWeight: "700" },
  message: { padding: 10, gap: 4, backgroundColor: theme.surfaceAlt, borderRadius: 14 },
  poll: { gap: 6, marginTop: 6 },
  pollEditor: { padding: 12, gap: 6 },
  composer: { flexDirection: "row", alignItems: "flex-end", gap: 8, padding: 12 },
  composeInput: { flex: 1, maxHeight: 120 },
});
