import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, AppState, FlatList, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../context/AuthContext";
import { useI18n } from "../lib/i18n";
import { useFocusEffect } from "@react-navigation/native";
import { apiErr, contacts } from "../lib/api";
import { contactAddress, matchesContact } from "../lib/contactAddress";
import { getVerified } from "../lib/verify";
import { cachedPilotGroupTitle, createPilotGroup, listPilotGroups, openPilotGroup, preparePilotGroupInvites, updatePilotGroup } from "../lib/pilotGroups";
import { theme } from "../theme";

export default function PilotGroupsScreen({ navigation }) {
  const { user } = useAuth();
  const { lang } = useI18n();
  const en = lang === "en";
  const say = (it, english) => en ? english : it;
  const [groups, setGroups] = useState([]);
  const [group, setGroup] = useState(null);
  const [details, setDetails] = useState(null);
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
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
    if (row) {
      const next = await openPilotGroup(user, row);
      if (current()) setDetails(next);
    } else {
      const rows = await listPilotGroups();
      const result = await Promise.all(rows.map(async item => ({...item, title: await cachedPilotGroupTitle(user, item)})));
      if (current()) setGroups(result);
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
    if (user) run(async () => { await refresh(null); await preparePilotGroupInvites(user); });
    return () => { alive.current = false; };
  }, [user, refresh]);

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
    setDetails(null); setGroup(row); setManage(false); setMessage(""); setQuery(""); setSelected([]);
    await refresh(row);
  });

  async function invite(row, addresses, initial) {
    let next = initial;
    const failures = [];
    let invited = 0;
    for (const address of addresses) {
      try {
        next = await updatePilotGroup(user, row, "add", address);
        setDetails(next);
        setSelected(previous => previous.filter(item => item !== address));
        invited++;
      } catch (error) {
        const hint = error?.response?.status === 404
          ? say("Il contatto deve aprire Gruppi sul suo telefono.", "The contact needs to open Groups on their phone.")
          : apiErr(error);
        failures.push(`${address} · ${hint}`);
      }
    }
    if (invited && next?.title) {
      try { setDetails(await updatePilotGroup(user, row, "title", next.title)); }
      catch (error) { failures.push(apiErr(error)); }
    }
    if (failures.length) setErr(failures.join("\n"));
  }

  const create = () => run(async () => {
    const title = name.trim();
    if (!title) return;
    const row = await createPilotGroup(user, title);
    setGroup(row); setDetails(null); setManage(true); setNewGroup(false); setName(""); setQuery("");
    const initial = await updatePilotGroup(user, row, "title", row.title || title);
    setDetails(initial);
    await invite(row, selected, initial);
  });
  const send = () => run(async () => {
    const text = message.trim();
    if (!text) return;
    setDetails(await updatePilotGroup(user, group, "message", text));
    setMessage("");
  });
  const remove = (address) => run(async () => {
    setDetails(await updatePilotGroup(user, group, "remove", address));
  });
  const goToList = () => run(async () => {
    setGroup(null); setDetails(null); setManage(false); setQuery(""); setSelected([]);
    await refresh(null);
  });


  const button = (label, onPress, { primary = false, disabled = busy } = {}) => (
    <TouchableOpacity onPress={onPress} disabled={disabled} accessibilityRole="button"
      style={[styles.button, primary && styles.primary, disabled && styles.disabled]}>
      <Text style={[styles.buttonText, primary && styles.primaryText]}>{label}</Text>
    </TouchableOpacity>
  );
  const warning = !!err && <Text style={styles.error} accessibilityLiveRegion="polite">{err}</Text>;
  const inputProps = { placeholderTextColor: theme.textDim, editable: !busy };
  const contactPicker = () => {
    const present = new Set(details?.members || []);
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
        {newGroup ? <View style={styles.card}>
          <Text style={styles.section}>{say("Nuovo gruppo", "New group")}</Text>
          <TextInput {...inputProps} style={styles.input} value={name} maxLength={60} onChangeText={setName}
            placeholder={say("Nome del gruppo", "Group name")} accessibilityLabel={say("Nome del gruppo", "Group name")} />
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
            <Text style={[styles.text, {flex: 1}]}>{account}</Text>
            {group.admin === user.lns && account !== user.lns && button(say("Rimuovi", "Remove"), () => remove(account))}
          </View>
        ))}
        {group.admin === user.lns && <View style={styles.card}>
          {contactPicker()}
          {button(say("Aggiungi al gruppo", "Add to group"), () => run(() => invite(group, selected, details)),
            {primary: true, disabled: busy || !details || !selected.length})}
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
  message: { padding: 10, gap: 4, backgroundColor: theme.surfaceAlt, borderRadius: 14 },
  composer: { flexDirection: "row", alignItems: "flex-end", gap: 8, padding: 12 },
  composeInput: { flex: 1, maxHeight: 120 },
});
