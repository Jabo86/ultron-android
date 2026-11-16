import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Image, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import EncryptedAttachment from "../components/EncryptedAttachment";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../context/AuthContext";
import { useI18n } from "../lib/i18n";
import { useFocusEffect } from "@react-navigation/native";
import { apiErr, contacts } from "../lib/api";
import { contactAddress, matchesContact } from "../lib/contactAddress";
import { pickAvatarDataUrl } from "../lib/avatar";
import { randomHex } from "../lib/crypto";
import { withSystemActivity } from "../lib/lockGuard";
import { usePoll } from "../lib/usePoll";
import { getVerified } from "../lib/verify";
import { cachedPilotGroupTitle, createPilotGroup, decidePilotGroupInvitation, listPilotGroups, listPublicPilotGroups, openPilotGroup,
  pilotGroupInvitations, pilotInvitationInbox, pilotInvitationTitle, preparePilotGroupInvites, presentPilotGroupHistory,
  PILOT_GROUP_AVATAR_LIMIT, PILOT_GROUP_FILE_LIMIT, requestPilotGroupInvitation, updatePilotGroup } from "../lib/pilotGroups";
import { theme } from "../theme";

export default function PilotGroupsScreen({ navigation, route }) {
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  useLayoutEffect(() => { navigation.setOptions({ headerShown: false }); }, [navigation]);
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
  const [initialAvatar, setInitialAvatar] = useState(null);
  const [composerMenu, setComposerMenu] = useState(false);
  const [fileDraft, setFileDraft] = useState(null);
  const [message, setMessage] = useState("");
  const draft = useRef(null);
  const [groupTab, setGroupTab] = useState("members");
  const [editing, setEditing] = useState(false);
  const [description, setDescription] = useState("");
  const [avatar, setAvatar] = useState(null);
  const [pollEditor, setPollEditor] = useState(false);
  const [question, setQuestion] = useState("");
  const [choices, setChoices] = useState(["", ""]);
  const listRef = useRef(null);
  const stickToBottom = useRef(true);
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
      let next = await openPilotGroup(user, row, { read: true });
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
          if (current()) { setDetails(next); setErr(""); }
        } catch (error) {
          if (current()) setErr(apiErr(error));
        }
      }
      if (changed) {
        invitations = await pendingFor();
        if (next.profile) next = await updatePilotGroup(user, row, "profile", next.profile);
        else if (next.title) next = await updatePilotGroup(user, row, "title", next.title);
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
    if (user) {
      run(() => refresh(routedGroup));
      if (!routedGroup) preparePilotGroupInvites(user).catch(() => {});
    }
    return () => { alive.current = false; };
  }, [user, refresh, routedGroup]);

  usePoll(async () => {
    if (running.current) return;
    const version = refreshVersion.current;
    try {
      await refresh(group);
      if (alive.current && version === refreshVersion.current && !triedInvites.current.size) setErr("");
    } catch (error) {
      if (alive.current && version === refreshVersion.current) setErr(apiErr(error));
    }
  }, 2000, { runOnFocus: false, active: !!user });

  const selectContact = (address) => setSelected(previous => previous.includes(address)
    ? previous.filter(value => value !== address) : [...previous, address]);

  const open = (row) => run(async () => {
    stickToBottom.current = true;
    draft.current = null;
    setComposerMenu(false); setFileDraft(null);
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
    const row = await createPilotGroup(user, title, visibility, initialAvatar);
    stickToBottom.current = true;
    draft.current = null;
    setGroup(row); setDetails(null); setManage(true); setGroupTab("members"); setNewGroup(false); setName(""); setQuery(""); setInitialAvatar(null);
    const initial = await updatePilotGroup(user, row, "profile", row.profile || { avatar: null, description: "" });
    setDetails(initial);
    if (selected.length) await invite(row, selected);
  });
  const send = () => run(async () => {
    const text = message.trim();
    if (!text) return;
    if (draft.current?.text !== text) draft.current = { text, id: randomHex(16) };
    setDetails(await updatePilotGroup(user, group, "message", text, undefined, draft.current.id));
    draft.current = null;
    setMessage("");
  });
  const pickFile = () => run(async () => {
    setComposerMenu(false);
    const result = await withSystemActivity(() => DocumentPicker.getDocumentAsync({ type: "*/*", copyToCacheDirectory: true }));
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    try {
      const info = await FileSystem.getInfoAsync(asset.uri, { size: true });
      const size = info.size;
      if (!info.exists || !Number.isSafeInteger(size) || size < 1 || size > PILOT_GROUP_FILE_LIMIT) {
        throw new Error(say("Scegli un file fino a 96 KB.", "Choose a file up to 96 KB."));
      }
      const data = await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.Base64,
        position: 0, length: PILOT_GROUP_FILE_LIMIT + 1 });
      const mime = /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(asset.mimeType || "") ? asset.mimeType : "application/octet-stream";
      const name = asset.name?.replace(/[\x00-\x1f\x7f]/g, "").trim().slice(0, 160) || say("Allegato", "Attachment");
      setFileDraft({ id: randomHex(16), attachment: { name, mime, size, data } });
    } finally {
      if (FileSystem.cacheDirectory && asset.uri.startsWith(FileSystem.cacheDirectory)) {
        await FileSystem.deleteAsync(asset.uri, { idempotent: true }).catch(() => {});
      }
    }
  });
  const sendFile = () => run(async () => {
    if (!fileDraft) return;
    setDetails(await updatePilotGroup(user, group, "attachment", fileDraft.attachment, undefined, fileDraft.id));
    setFileDraft(null);
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

  const editProfile = () => {
    setDescription(details?.profile?.description || "");
    setAvatar(details?.profile?.avatar || null);
    setEditing(true);
  };
  const choosePhoto = (onPhoto = setAvatar) => run(async () => {
    const photo = await withSystemActivity(() => pickAvatarDataUrl({
      allowOriginal: false, maxBytes: Math.floor((PILOT_GROUP_AVATAR_LIMIT - 64) * 3 / 4), maxWidth: 384,
    }));
    if (photo.denied) throw new Error(say("Consenti l’accesso alle foto.", "Allow photo access."));
    if (photo.error) throw new Error(say("Scegli una foto più piccola.", "Choose a smaller photo."));
    if (photo.dataUrl) onPhoto(photo.dataUrl);
  });
  const saveProfile = () => run(async () => {
    setDetails(await updatePilotGroup(user, group, "profile", { description, avatar }));
    setEditing(false);
  });
  const showInfo = () => {
    setGroupTab("members"); setEditing(false); setManage(true); setComposerMenu(false);
  };

  const openProfile = (peer) => navigation.navigate("Profilo", { peer });

  const button = (label, onPress, { primary = false, disabled = busy } = {}) => (
    <TouchableOpacity onPress={onPress} disabled={disabled} accessibilityRole="button"
      style={[styles.button, primary && styles.primary, disabled && styles.disabled]}>
      <Text style={[styles.buttonText, primary && styles.primaryText]}>{label}</Text>
    </TouchableOpacity>
  );
  const iconButton = (icon, label, onPress, disabled = false) => (
    <TouchableOpacity accessibilityRole="button" accessibilityLabel={label} onPress={onPress} disabled={disabled}
      style={[styles.iconButton, disabled && styles.disabled]}>
      <Ionicons name={icon} size={23} color={theme.text} />
    </TouchableOpacity>
  );
  const groupAvatar = (uri, large = false) => (
    <View style={[styles.avatar, large && styles.avatarLarge]}>
      {uri ? <Image source={{ uri }} style={styles.avatarImage} /> :
        <Ionicons name="people" size={large ? 43 : 22} color={theme.primary} />}
    </View>
  );
  const pageStyle = [styles.listPage, { paddingBottom: insets.bottom + 20 }];
  const topStyle = { paddingTop: insets.top };
  const backLabel = say("Indietro", "Back");
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
    <ScrollView style={[styles.root, topStyle]} contentContainerStyle={pageStyle}>
      {iconButton("arrow-back", backLabel, () => setDiscover(false))}
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
      <ScrollView style={[styles.root, topStyle]} contentContainerStyle={pageStyle} keyboardShouldPersistTaps="handled">
        {iconButton("arrow-back", backLabel, () => navigation.goBack())}
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
            </View> : <Text style={styles.dim}>{say("Accettato. L’ingresso si completa quando il fondatore è online in Chat o nel gruppo.", "Accepted. Entry completes when the founder is online in Chats or in the group.")}</Text>}
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
            {groupAvatar(initialAvatar)}
            {button(say("Scegli foto", "Choose photo"), () => choosePhoto(setInitialAvatar))}
            {!!initialAvatar && button(say("Rimuovi", "Remove"), () => setInitialAvatar(null))}
          </View>
          <View style={styles.actions}>
            {button(say("Privato", "Private"), () => setVisibility("private"), { primary: visibility === "private" })}
            {button(say("Pubblico", "Public"), () => setVisibility("public"), { primary: visibility === "public" })}
          </View>
          {visibility === "public" && <Text style={styles.dim}>{say("Nome e amministratore compaiono nell’elenco pubblico. Si entra su invito.", "The name and administrator appear in the public directory. Entry is by invitation.")}</Text>}
          {contactPicker()}
          {button(say("Crea gruppo", "Create group"), create, { primary: true, disabled: busy || !name.trim() })}
          {button(say("Annulla", "Cancel"), () => { setNewGroup(false); setName(""); setQuery(""); setSelected([]); setInitialAvatar(null); })}
        </View> : button(say("Nuovo gruppo", "New group"), () => setNewGroup(true), { primary: true })}
        {busy && <ActivityIndicator color={theme.primary} />}
      </ScrollView>
    );
  }
  const groupTitle = details?.title || group.title || say("Gruppo", "Group");
  const isFounder = group.admin === user.lns;
  const privacy = details?.profile?.visibility || group.profile?.visibility || group.visibility;
  const privacyLabel = privacy === "public" ? say("Pubblico", "Public") : privacy === "private" ? say("Privato", "Private") : null;
  const renderAttachment = (item) => item.attachment?.data ? (
    <EncryptedAttachment att={{ ...item.attachment, id: `${group.id}:${item.seq}` }} inlineData={item.attachment.data} />
  ) : <Text style={styles.dim}>{say("File non più disponibile su questo dispositivo.", "File no longer available on this device.")}</Text>;
  const hasRecipients = details?.members.length > 1;
  return (
    <KeyboardAvoidingView behavior="padding" style={[styles.root, topStyle]}>
      <View style={styles.header}>
        {iconButton("arrow-back", backLabel, manage ? () => { setManage(false); setEditing(false); } : goToList)}
        <TouchableOpacity style={styles.groupHeading} onPress={showInfo} disabled={manage}
          accessibilityRole="button" accessibilityLabel={say("Informazioni gruppo", "Group information")}>
          {groupAvatar(details?.profile?.avatar || (!details ? group.avatar : null))}
          <View style={styles.headingText}>
            <Text style={styles.section} numberOfLines={1}>{groupTitle}</Text>
            <Text style={styles.dim} numberOfLines={1}>{manage ? say("Informazioni gruppo", "Group information") :
              (details ? [privacyLabel, `${details.members.length} ${say("membri", "members")}`].filter(Boolean).join(" · ") : say("Sincronizzazione…", "Syncing…"))}</Text>
          </View>
        </TouchableOpacity>
      </View>
      {warning}
      {!!err && !details && button(say("Riprova a sincronizzare", "Retry sync"), () => run(() => refresh(group)))}
      {manage ? <ScrollView contentContainerStyle={pageStyle} keyboardShouldPersistTaps="handled">
        <View style={styles.profileHeader}>
          {groupAvatar(editing ? avatar : details?.profile?.avatar, true)}
          <Text style={styles.title}>{groupTitle}</Text>
          {!!details?.profile?.description && !editing && <Text style={styles.description}>{details.profile.description}</Text>}
          {isFounder && details && !editing && button(say("Modifica foto e descrizione", "Edit photo and description"), editProfile)}
          {editing && <View style={styles.profileEdit}>
            <View style={styles.actions}>
              {button(say("Scegli foto", "Choose photo"), choosePhoto)}
              {!!avatar && button(say("Rimuovi foto", "Remove photo"), () => setAvatar(null))}
            </View>
            <TextInput {...inputProps} style={styles.input} multiline maxLength={512} value={description} onChangeText={setDescription}
              placeholder={say("Descrizione del gruppo", "Group description")} accessibilityLabel={say("Descrizione del gruppo", "Group description")} />
            <View style={styles.actions}>
              {button(say("Salva", "Save"), saveProfile, { primary: true })}
              {button(say("Annulla", "Cancel"), () => setEditing(false))}
            </View>
          </View>}
        </View>
        <View accessibilityRole="tablist" style={styles.tabs}>
          {[["members", say("Membri", "Members")], ["media", say("Allegati", "Attachments")], ["info", say("Informazioni", "Information")]].map(([key, label]) => (
            <TouchableOpacity key={key} accessibilityRole="tab" accessibilityState={{ selected: groupTab === key }}
              onPress={() => setGroupTab(key)} style={[styles.tab, groupTab === key && styles.tabActive]}>
              <Text style={[styles.buttonText, groupTab === key && styles.sender]}>{label}</Text>
            </TouchableOpacity>
          ))}
        </View>
        {groupTab === "info" ? <View style={styles.card}>
          <Text style={styles.section}>{say("Crittografia end-to-end", "End-to-end encryption")}</Text>
          <Text style={styles.dim}>{say("Solo i membri possono leggere i messaggi, la foto e la descrizione. Chi entra vede i messaggi inviati dopo il suo ingresso.", "Only members can read messages, the photo and the description. New members see messages sent after they join.")}</Text>
          <TouchableOpacity onPress={() => openProfile(group.admin)} accessibilityRole="button">
            <Text style={styles.sender}>{say("Fondatore", "Founder")} · {group.admin}</Text>
          </TouchableOpacity>
        </View> : groupTab === "media" ? (
          <View style={styles.picker}>
            {history.some(item => item.attachment) ? history.filter(item => item.attachment).map(item => (
              <View key={item.seq} style={styles.card}><Text style={styles.text}>{item.attachment.name}</Text>{renderAttachment(item)}</View>
            )) : <Text style={styles.dim}>{say("Nessun allegato.", "No attachments.")}</Text>}
          </View>
        ) : <>
        {(details?.members || []).map(account => (
          <View style={styles.row} key={account}>
            <TouchableOpacity onPress={() => openProfile(account)} accessibilityRole="button" style={{ flex: 1, paddingVertical: 6 }}>
              <Text style={styles.text}>{account === user.lns ? say("Tu", "You") : account}</Text>
              {account === group.admin && <Text style={styles.dim}>{say("Fondatore", "Founder")}</Text>}
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
        </>}
      </ScrollView> : <>
        <FlatList ref={listRef} style={styles.messageList} data={history} keyboardShouldPersistTaps="handled"
          onScroll={({ nativeEvent }) => {
            const { layoutMeasurement, contentOffset, contentSize } = nativeEvent;
            stickToBottom.current = contentSize.height - contentOffset.y - layoutMeasurement.height < 100;
          }} scrollEventThrottle={32}
          onContentSizeChange={() => { if (stickToBottom.current) listRef.current?.scrollToEnd({ animated: false }); }}
          ListEmptyComponent={<Text style={styles.empty}>{details
            ? say("I nuovi messaggi compariranno qui.", "New messages will appear here.")
            : say("Sincronizzazione della chat…", "Syncing the chat…")}</Text>} keyExtractor={item => String(item.seq)} contentContainerStyle={styles.messages}
          renderItem={({item}) => <View style={[styles.message, item.sender === user.lns && styles.ownMessage]}>
            <TouchableOpacity onPress={() => openProfile(item.sender)} accessibilityRole="button">
              <Text style={styles.sender}>{item.sender}{item.sender === group.admin ? " · " + say("Fondatore", "Founder") : ""}</Text>
            </TouchableOpacity>
            <Text style={styles.text}>{item.body}</Text>
            {!!item.attachment && renderAttachment(item)}
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
        {composerMenu && <View style={styles.menu}>
          {button(say("Allegati", "Attachments") + " · 96 KB", pickFile)}
          {button(say("Sondaggio", "Poll"), () => { setComposerMenu(false); setPollEditor(value => !value); })}
        </View>}
        {fileDraft && <View style={styles.menu}>
          <Text numberOfLines={1} style={[styles.text, styles.fileName]}>{fileDraft.attachment.name}</Text>
          {button(say("Annulla", "Cancel"), () => setFileDraft(null))}
          {button(say("Invia file", "Send file"), sendFile, { primary: true, disabled: busy || !hasRecipients })}
        </View>}
        <View style={[styles.composer, { paddingBottom: Math.max(insets.bottom, 10) }]}>
          {details && !hasRecipients ? <Text style={styles.dim}>{say("Sarai in grado di scrivere quando sarà entrato almeno un altro membro.", "You can write once another member has joined.")}</Text> :
            <View style={styles.composerRow}>
              {iconButton(composerMenu ? "close" : "add", say("Allegati e sondaggi", "Attachments and polls"),
                () => { setPollEditor(false); setComposerMenu(value => !value); }, busy || !hasRecipients || !!fileDraft)}
              <TextInput {...inputProps} style={[styles.input, styles.composeInput]} placeholder={say("Scrivi un messaggio", "Write a message")}
                editable={!busy && hasRecipients} accessibilityLabel={say("Scrivi un messaggio", "Write a message")}
                maxLength={2000} multiline value={message} onChangeText={setMessage} />
              {iconButton("send", say("Invia", "Send"), send, busy || !hasRecipients || !message.trim())}
            </View>}
        </View>
      </>}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.bg },
  listPage: { padding: 18, gap: 12, paddingBottom: 36 },
  header: { paddingHorizontal: 8, paddingVertical: 8, flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: theme.surface, borderBottomWidth: 1, borderColor: theme.border },
  iconButton: { width: 44, height: 44, borderRadius: 22, justifyContent: "center", alignItems: "center" },
  groupHeading: { flex: 1, flexDirection: "row", alignItems: "center", gap: 10 },
  headingText: { flex: 1 },
  avatar: { width: 40, height: 40, borderRadius: 20, overflow: "hidden", backgroundColor: theme.surfaceAlt, alignItems: "center", justifyContent: "center" },
  avatarLarge: { width: 100, height: 100, borderRadius: 50 },
  avatarImage: { width: "100%", height: "100%" },
  profileHeader: { alignItems: "center", gap: 12, paddingTop: 10, paddingBottom: 12 },
  description: { color: theme.text, fontSize: 15, textAlign: "center" },
  profileEdit: { alignSelf: "stretch", gap: 10 },
  tabs: { flexDirection: "row", borderBottomWidth: 1, borderColor: theme.border },
  tab: { flex: 1, paddingVertical: 12, alignItems: "center" },
  tabActive: { borderBottomWidth: 2, borderColor: theme.primary },
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
  messageList: { flex: 1 },
  messages: { flexGrow: 1, justifyContent: "flex-end", padding: 12, gap: 8 },
  empty: { color: theme.textDim, textAlign: "center", padding: 14 },
  sender: { color: theme.primary, fontSize: 13, fontWeight: "700" },
  message: { alignSelf: "flex-start", maxWidth: "88%", padding: 10, gap: 4, backgroundColor: theme.surfaceAlt, borderRadius: 14 },
  ownMessage: { alignSelf: "flex-end", borderWidth: 1, borderColor: theme.primary },
  poll: { gap: 6, marginTop: 6 },
  pollEditor: { padding: 12, gap: 6 },
  composer: { paddingHorizontal: 8, paddingTop: 8, backgroundColor: theme.surface, borderTopWidth: 1, borderColor: theme.border },
  menu: { flexDirection: "row", alignItems: "center", padding: 8, gap: 6, backgroundColor: theme.surface },
  fileName: { flex: 1 },
  composerRow: { flexDirection: "row", alignItems: "flex-end", gap: 4 },
  composeInput: { flex: 1, maxHeight: 120 },
});
