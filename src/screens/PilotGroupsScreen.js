import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, FlatList, Image, ScrollView, Share, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import EncryptedAttachment from "../components/EncryptedAttachment";
import SafeText from "../components/SafeText";
import ThreatBanner from "../components/ThreatBanner";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../context/AuthContext";
import { useI18n } from "../lib/i18n";
import { useFocusEffect } from "@react-navigation/native";
import { apiErr, contacts, mlsAction, mlsDeleteGroup, mlsRedeem, mlsReport, mlsReports, mlsReview,
  mlsUpload } from "../lib/api";
import { contactAddress, matchesContact } from "../lib/contactAddress";
import { pickAvatarDataUrl } from "../lib/avatar";
import { base64ToBytes, encryptFileBytes, randomHex } from "../lib/crypto";
import { withSystemActivity } from "../lib/lockGuard";
import { analyzeMessage } from "../lib/threatEngine";
import { usePoll } from "../lib/usePoll";
import { getVerified } from "../lib/verify";
import { announcePilotGroupProfile, cachedPilotGroupDetails, cachedPilotGroupTitle, createPilotGroup, decidePilotGroupInvitation, deliverPilotGroupInvitation, finishAcceptedPilotGroupInvites,
  forgetPilotGroup, listPilotGroups, listPublicPilotGroups, openPilotGroup, pilotGroupPolicy,
  pilotGroupInvitations, pilotInvitationInbox, pilotInvitationTitle, preparePilotGroupInvites, presentPilotGroupHistory,
  PILOT_GROUP_AVATAR_LIMIT, PILOT_GROUP_FILE_LIMIT, PILOT_GROUP_UPLOAD_LIMIT, requestPilotGroupInvitation,
  updatePilotGroup, verifyPilotGroupAccount } from "../lib/pilotGroups";
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
  const triedInvites = useRef(new Map());
  const routedGroup = route?.params?.group || null;
  const [group, setGroup] = useState(routedGroup);
  const [details, storeDetails] = useState(null);
  const setDetails = useCallback(next => storeDetails(previous =>
    previous && next && previous.history === next.history && previous.members === next.members &&
      previous.title === next.title && previous.profile === next.profile ? previous : next
  ), []);
  const [name, setName] = useState("");
  const [initialAvatar, setInitialAvatar] = useState(null);
  const [composerMenu, setComposerMenu] = useState(false);
  const [pendingFile, setFileDraft] = useState(null);
  const fileDraft = pendingFile?.groupId === group?.id ? pendingFile : null;
  const [policy, setPolicy] = useState(null);
  const [inviteCode, setInviteCode] = useState("");
  const [joiningLink, setJoiningLink] = useState(route?.params?.inviteCode || "");
  const [redeemOpen, setRedeemOpen] = useState(!!route?.params?.inviteCode);
  const [reportForm, setReportForm] = useState(null);
  const [reportReason, setReportReason] = useState("");
  const [reports, setReports] = useState(null);
  const [moderate, setModerate] = useState(null);
  const [editTitle, setEditTitle] = useState("");
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
  const history = useMemo(() => {
    const hidden = new Set(policy?.hidden || []);
    return presentPilotGroupHistory((details?.history || []).filter(item => !hidden.has(item.seq)), user?.lns);
  }, [details, policy?.hidden, user?.lns]);
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
  const metadataChecked = useRef({ id: null, at: 0 });

  const refresh = useCallback(async (row, background = false) => {
    const version = refreshVersion.current;
    const current = () => alive.current && version === refreshVersion.current;
    let access;
    async function pendingFor() {
      if (row?.admin !== user.lns && access?.role !== "admin") return [];
      return pilotGroupInvitations(user, row).catch(error => {
        if (error?.response?.status === 404) return [];
        throw error;
      });
    }
    if (row) {
      if (background && metadataChecked.current.id === row.id && Date.now() - metadataChecked.current.at < 7000) {
        const details = await openPilotGroup(user, row, { read: true });
        if (current()) setDetails(details);
        return;
      }
      metadataChecked.current = { id: row.id, at: Date.now() };
      const incoming = openPilotGroup(user, row, { read: true }).then(details => ({ details }), error => ({ error }));
      const [permissions, cached] = await Promise.all([pilotGroupPolicy(row), cachedPilotGroupDetails(user, row)]);
      access = permissions;
      if (current()) {
        setPolicy(access);
        if (access && cached && !background) setDetails(cached);
      }
      const result = await incoming;
      if (result.error) throw result.error;
      let next = result.details;
      if (row.admin === user.lns && access?.leaving?.length) {
        for (const account of access.leaving) next = await updatePilotGroup(user, row, "remove", account);
        access = await pilotGroupPolicy(row);
        if (current()) setPolicy(access);
      }
      if (current()) setDetails(next);
      let invitations = await pendingFor();
      let changed = false;
      for (const invitation of invitations) {
        if (!current()) return;
        if (row.admin !== user.lns || invitation.status !== "accepted" || Date.now() - (triedInvites.current.get(invitation.id) || 0) < 15000) continue;
        triedInvites.current.set(invitation.id, Date.now());
        try {
          next = await updatePilotGroup(user, row, "add", invitation.target, invitation);
          changed = true;
          triedInvites.current.delete(invitation.id);
          if (current()) { setDetails(next); setErr(""); }
        } catch (error) {
          if (current()) setErr(apiErr(error));
        }
      }
      if (changed) invitations = await pendingFor();
      const published = await announcePilotGroupProfile(user, row);
      if (published) next = published;
      if (current()) { setOutgoing(invitations); setDetails(next); }
    } else {
      const rows = await listPilotGroups();
      const invitations = await pilotInvitationInbox(user).catch(error => {
        if (error?.response?.status === 404) return [];
        throw error;
      });
      const result = await Promise.all(rows.map(async item => ({ ...item, title: await cachedPilotGroupTitle(user, item) })));
      const incoming = await Promise.all(invitations.map(async item => ({ ...item, title: await pilotInvitationTitle(user, item),
        needsQr: item.status === "accepted" && !(await getVerified(item.inviter))?.fp })));
      if (incoming.some(item => item.status === "accepted")) preparePilotGroupInvites(user).catch(() => {});
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
        return { ...entry, lns, verified: /^[a-f0-9]{64}$/.test(record?.fp || "") };
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
      await refresh(group, true);
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
    setComposerMenu(false); setFileDraft(null); setQuestion(""); setChoices(["", ""]);
    triedInvites.current.clear();
    setPolicy(null); setInviteCode(""); setModerate(null); setReports(null); setReportForm(null);
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
    setPolicy(await pilotGroupPolicy(row)); setInviteCode(""); setModerate(null); setReports(null); setReportForm(null);
    stickToBottom.current = true;
    draft.current = null;
    setMessage(""); setFileDraft(null); setComposerMenu(false); setPollEditor(false); setQuestion(""); setChoices(["", ""]);
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
    if (!group) return;
    const result = await withSystemActivity(() => DocumentPicker.getDocumentAsync({ type: "*/*", copyToCacheDirectory: true }));
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    try {
      const info = await FileSystem.getInfoAsync(asset.uri, { size: true });
      const size = info.size;
      const limit = policy ? PILOT_GROUP_UPLOAD_LIMIT : PILOT_GROUP_FILE_LIMIT;
      if (!info.exists || !Number.isSafeInteger(size) || size < 1 || size > limit) {
        throw new Error(policy ? say("Scegli un file fino a 1 MiB.", "Choose a file up to 1 MiB.") :
          say("Scegli un file fino a 96 KB.", "Choose a file up to 96 KB."));
      }
      const data = await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.Base64,
        position: 0, length: limit + 1 });
      const mime = /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(asset.mimeType || "") ? asset.mimeType : "application/octet-stream";
      const name = asset.name?.replace(/[\x00-\x1f\x7f]/g, "").trim().slice(0, 160) || say("Allegato", "Attachment");
      setFileDraft({ id: randomHex(16), groupId: group.id, attachment: { name, mime, size, data } });
    } finally {
      if (FileSystem.cacheDirectory && asset.uri.startsWith(FileSystem.cacheDirectory)) {
        await FileSystem.deleteAsync(asset.uri, { idempotent: true }).catch(() => {});
      }
    }
  });
  const sendFile = () => run(async () => {
    if (!fileDraft) return;
    let attachment = fileDraft.attachment;
    if (!attachment.id && attachment.size > PILOT_GROUP_FILE_LIMIT) {
      const { data, ...metadata } = attachment;
      const bytes = base64ToBytes(data);
      if (bytes.length !== metadata.size) throw new Error(say("File incompleto.", "Incomplete file."));
      const sealed = fileDraft.sealed || encryptFileBytes(bytes);
      if (!fileDraft.sealed) setFileDraft({ ...fileDraft, sealed });
      const { ciphertext, key, iv } = sealed;
      const result = await mlsUpload(group.id, fileDraft.id, ciphertext);
      if (result?.id !== fileDraft.id) throw new Error(say("Caricamento non confermato.", "Upload not confirmed."));
      attachment = { ...metadata, id: result.id, key, iv };
      setFileDraft({ ...fileDraft, attachment });
    }
    setDetails(await updatePilotGroup(user, group, "attachment", attachment, undefined, fileDraft.id));
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
      draft.current = null;
      setMessage(""); setFileDraft(null); setComposerMenu(false); setPollEditor(false); setQuestion(""); setChoices(["", ""]);
      setGroup(null); setDetails(null); setManage(false); setQuery(""); setSelected([]);
      await refresh(null);
    });
  };

  const changePolicy = (payload) => run(async () => {
    await mlsAction(group.id, payload);
    if (payload.action === "remove" && group.admin === user.lns) await finishAcceptedPilotGroupInvites(user, group);
    await refresh(group);
  });
  const reviewInvite = (id, accept) => run(async () => {
    await mlsReview(id, accept);
    await refresh(group);
  });
  const verifyAccount = () => run(async () => {
    await verifyPilotGroupAccount(user);
    await refresh(null);
  });
  const redeem = () => run(async () => {
    const code = joiningLink.trim().replace(/^ultron:\/\/group-invite\//i, "");
    if (!/^[a-f0-9]{64}\.[a-f0-9]{64}$/.test(code)) throw new Error(say("Link ULTRON non valido.", "Invalid ULTRON link."));
    await mlsRedeem(code);
    setJoiningLink(""); setRedeemOpen(false);
    await refresh(null);
  });
  useEffect(() => {
    if (route?.params?.inviteCode && !routedGroup) {
      setJoiningLink(route.params.inviteCode); setRedeemOpen(true);
      navigation.setParams({ inviteCode: undefined });
    }
  }, [route?.params?.inviteCode, routedGroup, navigation]);
  const renewLink = () => run(async () => {
    const result = await mlsAction(group.id, { action: "link" });
    if (!/^[a-f0-9]{64}\.[a-f0-9]{64}$/.test(result?.code || "")) throw new Error(say("Link non confermato.", "Link not confirmed."));
    setInviteCode(`ultron://group-invite/${result.code}`);
  });
  const exitGroup = async (deleting, block = false) => {
    if (deleting) await mlsDeleteGroup(group.id);
    else await mlsAction(group.id, { action: "leave" });
    await forgetPilotGroup(user, group.id, block);
    if (routedGroup) navigation.goBack();
    else {
      setGroup(null); setDetails(null); setPolicy(null); setManage(false);
      await refresh(null);
    }
  };
  const confirmExit = (deleting) => Alert.alert(
    deleting ? say("Elimina gruppo", "Delete group") : say("Abbandona gruppo", "Leave group"),
    deleting ? say("Il gruppo e i suoi contenuti saranno rimossi dal gateway.", "The group and its contents will be removed from the gateway.") :
      say("Il gruppo sparirà dalla tua lista chat.", "The group will disappear from your chat list."),
    [{ text: say("Annulla", "Cancel"), style: "cancel" }, {
      text: deleting ? say("Elimina", "Delete") : say("Abbandona", "Leave"), style: "destructive",
      onPress: () => run(() => exitGroup(deleting)),
    }],
  );
  const startReport = (target = null) => {
    setReportReason(""); setReportForm({ target });
  };
  const submitReport = (leave) => run(async () => {
    await mlsReport(group.id, { target: reportForm.target, reason: reportReason.trim() });
    setReportForm(null);
    if (leave) await exitGroup(false, true);
    else Alert.alert(say("Segnalazione inviata", "Report sent"));
  });

  const editProfile = () => {
    setEditTitle(details?.title || group.title || say("Gruppo", "Group"));
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
    setDetails(await updatePilotGroup(user, group, group.admin === user.lns ? "profile" : "managed-profile",
      { title: editTitle, description, avatar }));
    if (policy?.visibility === "public" && editTitle.trim()) {
      await mlsAction(group.id, { action: "visibility", visibility: "public", name: editTitle.trim() });
    }
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
              {button(say("Verifica QR", "Verify QR"), () => navigation.navigate("VerifyContact", { peer: row.lns, peer_name: label }))}
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
        {button(say("Usa link d’invito", "Use invitation link"), () => setRedeemOpen(value => !value))}
        {redeemOpen && <View style={styles.card}>
          <TextInput {...inputProps} style={styles.input} value={joiningLink} onChangeText={setJoiningLink}
            autoCapitalize="none" autoCorrect={false} maxLength={200}
            placeholder={say("Incolla il link ULTRON", "Paste the ULTRON link")} />
          {button(say("Apri invito", "Open invitation"), redeem, { primary: true, disabled: busy || !joiningLink.trim() })}
        </View>}
        {inbox.map(invitation => (
          <View key={invitation.id} style={styles.card}>
            <Text style={styles.section}>{invitation.title || say("Invito al gruppo", "Group invitation")}</Text>
            <TouchableOpacity onPress={() => openProfile(invitation.inviter)} accessibilityRole="button">
              <Text style={styles.sender}>{invitation.inviter}</Text>
            </TouchableOpacity>
            {invitation.status === "pending" ? <View style={styles.actions}>
              {button(say("Accetta", "Accept"), () => decide(invitation, "accepted"), { primary: true })}
              {button(say("Rifiuta", "Decline"), () => decide(invitation, "declined"))}
            </View> : invitation.status === "verification" ? <View style={styles.picker}>
              <Text style={styles.dim}>{say("Verifica l’account per attivare lettura e scrittura.", "Verify your account to enable reading and writing.")}</Text>
              {button(say("Verifica account", "Verify account"), verifyAccount, { primary: true })}
            </View> : invitation.needsQr ? <View style={styles.picker}>
              <Text style={styles.dim}>{say("Invito accettato. Verifica il QR del fondatore per aprire il gruppo.", "Invitation accepted. Verify the founder’s QR to open the group.")}</Text>
              {button(say("Verifica contatto", "Verify contact"), () => navigation.navigate("VerifyContact",
                { peer: invitation.inviter, peer_name: invitation.inviter }))}
            </View> : <Text style={styles.dim}>{invitation.status === "review" ?
              say("In attesa di approvazione.", "Waiting for approval.") :
              say("Accettato. L’ingresso si completa quando il fondatore è online in Chat o nel gruppo.", "Accepted. Entry completes when the founder is online in Chats or in the group.")}</Text>}
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
  const isAdmin = isFounder || policy?.role === "admin";
  const ranks = { member: 1, moderator: 2, admin: 3, founder: 4 };
  const myRank = ranks[policy?.role || (isFounder ? "founder" : "member")];
  const roleOf = (account) => policy?.members?.find(entry => entry.account === account)?.role ||
    (group.admin === account ? "founder" : "member");
  const canModerate = (target) => myRank >= 2 && target !== user.lns && ranks[roleOf(target)] < myRank;
  const roleLabel = (account) => ({ founder: say("Fondatore", "Founder"), admin: say("Admin", "Admin"),
    moderator: say("Moderatore", "Moderator") })[roleOf(account)];
  const privacy = policy?.visibility || details?.profile?.visibility || group.profile?.visibility || group.visibility;
  const privacyLabel = privacy === "public" ? say("Pubblico", "Public") : privacy === "private" ? say("Privato", "Private") : null;
  const renderAttachment = (item) => item.attachment?.id || item.attachment?.data ? (
    <EncryptedAttachment att={{ ...item.attachment, id: item.attachment.id || `${group.id}:${item.seq}` }}
      inlineData={item.attachment.data} pilotGroup={item.attachment.id ? group.id : undefined} />
  ) : <Text style={styles.dim}>{say("File non più disponibile su questo dispositivo.", "File no longer available on this device.")}</Text>;
  const hasRecipients = details?.members.length > 1 && !policy?.muted && !policy?.rotating;
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
      <View style={styles.signalTrack} accessibilityElementsHidden importantForAccessibility="no">
        <View style={styles.signalLead} /><View style={styles.signalTail} />
      </View>
      {warning}
      {!!err && !details && button(say("Riprova a sincronizzare", "Retry sync"), () => run(() => refresh(group)))}
      {manage ? <ScrollView contentContainerStyle={pageStyle} keyboardShouldPersistTaps="handled">
        <View style={styles.profileHeader}>
          {groupAvatar(editing ? avatar : details?.profile?.avatar, true)}
          <Text style={styles.title}>{groupTitle}</Text>
          {!!details?.profile?.description && !editing && <Text style={styles.description}>{details.profile.description}</Text>}
          {isAdmin && details && !editing && button(say("Modifica foto e descrizione", "Edit photo and description"), editProfile)}
          {editing && <View style={styles.profileEdit}>
            <TextInput {...inputProps} style={styles.input} value={editTitle} onChangeText={setEditTitle} maxLength={60}
              placeholder={say("Nome del gruppo", "Group name")} />
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
          {policy && isAdmin && <>
            {button(privacy === "public" ? say("Rendi privato", "Make private") : say("Rendi pubblico", "Make public"),
              () => changePolicy({ action: "visibility", visibility: privacy === "public" ? "private" : "public", name: groupTitle }))}
            {button(inviteCode ? say("Reimposta link", "Reset link") : say("Genera link d’invito", "Create invitation link"), renewLink)}
            {!!inviteCode && <>
              <Text selectable style={styles.text}>{inviteCode}</Text>
              {button(say("Condividi link", "Share link"), () => withSystemActivity(() => Share.share({ message: inviteCode })).catch(() => {}))}
            </>}
            {button(say("Segnalazioni ricevute", "Received reports"), () => run(async () => { setReports(await mlsReports(group.id)); }))}
            {reports && (reports.length ? reports.map(item => <View key={item.id} style={styles.row}>
              <Text style={styles.text}>{item.target ? `${item.target} · ` : ""}{item.reason}</Text></View>) :
              <Text style={styles.dim}>{say("Nessuna segnalazione.", "No reports.")}</Text>)}
          </>}
          {policy && button(say("Segnala gruppo", "Report group"), () => startReport())}
          {policy && button(isFounder ? say("Elimina gruppo", "Delete group") : say("Abbandona gruppo", "Leave group"),
            () => confirmExit(isFounder))}
          {reportForm && <View style={styles.picker}>
            <Text style={styles.dim}>{say("Il motivo sarà visibile agli amministratori del gruppo.", "Group administrators will see your reason.")}</Text>
            <TextInput {...inputProps} style={styles.input} value={reportReason} maxLength={500}
              onChangeText={setReportReason} multiline placeholder={say("Motivo", "Reason")} />
            {button(say("Invia segnalazione", "Send report"), () => submitReport(false), { primary: true, disabled: busy || !reportReason.trim() })}
            {!isFounder && button(say("Segnala, esci e blocca", "Report, leave and block"), () => submitReport(true), { disabled: busy || !reportReason.trim() })}
            {button(say("Annulla", "Cancel"), () => setReportForm(null))}
          </View>}
        </View> : groupTab === "media" ? (
          <View style={styles.picker}>
            {history.some(item => item.attachment) ? history.filter(item => item.attachment).map(item => (
              <View key={item.seq} style={styles.card}><Text style={styles.text}>{item.attachment.name}</Text>{renderAttachment(item)}</View>
            )) : <Text style={styles.dim}>{say("Nessun allegato.", "No attachments.")}</Text>}
          </View>
        ) : <>
        {(policy ? policy.members.map(item => item.account) : details?.members || []).map(account => (
          <View key={account}>
          <View style={styles.row}>
            <TouchableOpacity onPress={() => openProfile(account)} accessibilityRole="button" style={{ flex: 1, paddingVertical: 6 }}>
              <Text style={styles.text}>{account === user.lns ? say("Tu", "You") : account}</Text>
              {!!roleLabel(account) && <Text style={styles.dim}>{roleLabel(account)}</Text>}
            </TouchableOpacity>
            {policy && account !== user.lns ? button(say("Azioni", "Actions"), () => setModerate(value => value === account ? null : account)) :
              isFounder && account !== user.lns && button(say("Rimuovi", "Remove"), () => remove(account))}
          </View>
          {moderate === account && <View style={styles.card}>
            {canModerate(account) && <>
              {myRank >= 3 && button(say("Nomina moderatore", "Appoint moderator"), () => changePolicy({ action: "role", target: account, role: "moderator" }))}
              {isFounder && button(say("Nomina admin", "Appoint admin"), () => changePolicy({ action: "role", target: account, role: "admin" }))}
              {myRank >= 3 && roleOf(account) !== "member" && button(say("Revoca ruolo", "Revoke role"), () => changePolicy({ action: "role", target: account, role: "member" }))}
              {button(say("Silenzia 1 ora", "Mute for 1 hour"), () => changePolicy({ action: "mute", target: account, minutes: 60 }))}
              {button(say("Riattiva invio", "Unmute"), () => changePolicy({ action: "mute", target: account, minutes: 0 }))}
              {button(say("Espelli", "Remove"), () => changePolicy({ action: "remove", target: account }))}
            </>}
            {button(say("Segnala utente", "Report user"), () => { startReport(account); setGroupTab("info"); })}
          </View>}
          </View>
        ))}
        {isAdmin && <View style={styles.card}>
          {outgoing.map(invitation => (
            <View key={invitation.id} style={styles.row}>
              <Text style={[styles.dim, { flex: 1 }]}>{invitation.target} · {invitation.status === "declined"
                ? say("Rifiutato", "Declined") : invitation.status === "accepted" ? say("Accettato", "Accepted") : say("In attesa", "Pending")}</Text>
              {invitation.status === "pending" && !invitation.link && button(say("Invia nella chat", "Send in chat"),
                () => run(() => deliverPilotGroupInvitation(user, group, invitation)))}
              {invitation.status === "review" && policy && <>
                {button(say("Approva", "Approve"), () => reviewInvite(invitation.id, true))}
                {button(say("Rifiuta", "Decline"), () => reviewInvite(invitation.id, false))}
              </>}
              {invitation.status === "accepted" && isFounder && button(say("Completa ingresso", "Complete entry"), () => retryInvite(invitation))}
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
              <Text style={styles.sender}>{item.sender}{roleLabel(item.sender) ? " · " + roleLabel(item.sender) : ""}</Text>
            </TouchableOpacity>
            {!!item.body && <SafeText text={item.body} style={styles.text} lang={lang} />}
            {!!item.body && <ThreatBanner result={analyzeMessage(item.body, lang)} lang={lang} context="Gruppo MLS" />}
            {!!item.attachment && renderAttachment(item)}
            {policy && canModerate(item.sender) && button(say("Rimuovi messaggio", "Remove message"),
              () => changePolicy({ action: "hide", seq: item.seq }))}
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
          {button(say("Allegati", "Attachments") + (policy ? " · 1 MiB" : " · 96 KB"), pickFile)}
          {button(say("Sondaggio", "Poll"), () => { setComposerMenu(false); setPollEditor(value => !value); })}
        </View>}
        {fileDraft && <View style={styles.menu}>
          <Text numberOfLines={1} style={[styles.text, styles.fileName]}>{fileDraft.attachment.name}</Text>
          {button(say("Annulla", "Cancel"), () => setFileDraft(null))}
          {button(say("Invia file", "Send file"), sendFile, { primary: true, disabled: busy || !hasRecipients })}
        </View>}
        <View style={[styles.composer, { paddingBottom: Math.max(insets.bottom, 10) }]}>
          {details && !hasRecipients ? <Text style={styles.dim}>{policy?.muted ?
            say("Il tuo invio è temporaneamente silenziato.", "You are temporarily muted.") : policy?.rotating ?
            say("Rinnovo delle chiavi del gruppo in corso.", "Group keys are being rotated.") :
            say("Sarai in grado di scrivere quando sarà entrato almeno un altro membro.", "You can write once another member has joined.")}</Text> :
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
  signalTrack: { height: 3, flexDirection: "row", gap: 6, paddingHorizontal: 10, backgroundColor: theme.surface },
  signalLead: { height: 1, width: 50, backgroundColor: theme.accent },
  signalTail: { height: 1, flex: 1, backgroundColor: theme.accentLine },
  iconButton: { width: 44, height: 44, borderRadius: 12, borderWidth: 1, borderColor: theme.border,
    backgroundColor: theme.surfaceAlt, justifyContent: "center", alignItems: "center" },
  groupHeading: { flex: 1, flexDirection: "row", alignItems: "center", gap: 10 },
  headingText: { flex: 1 },
  avatar: { width: 40, height: 40, borderRadius: 12, borderWidth: 1, borderColor: theme.accentLine, overflow: "hidden", backgroundColor: theme.accentWash, alignItems: "center", justifyContent: "center" },
  avatarLarge: { width: 100, height: 100, borderRadius: 50 },
  avatarImage: { width: "100%", height: "100%" },
  profileHeader: { alignItems: "center", gap: 12, paddingTop: 10, paddingBottom: 12 },
  description: { color: theme.text, fontSize: 15, textAlign: "center" },
  profileEdit: { alignSelf: "stretch", gap: 10 },
  tabs: { flexDirection: "row", borderBottomWidth: 1, borderColor: theme.border },
  tab: { flex: 1, paddingVertical: 12, alignItems: "center" },
  tabActive: { borderBottomWidth: 2, borderColor: theme.primary },
  title: { color: theme.text, fontSize: 31, fontWeight: "800", letterSpacing: 0.8 },
  section: { color: theme.text, fontSize: 17, fontWeight: "800", letterSpacing: 0.2, flexShrink: 1 },
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
  primaryText: { color: theme.onAccent },
  messageList: { flex: 1 },
  messages: { flexGrow: 1, justifyContent: "flex-end", padding: 12, gap: 8 },
  empty: { color: theme.textDim, textAlign: "center", padding: 14 },
  sender: { color: theme.primary, fontSize: 13, fontWeight: "700" },
  message: { alignSelf: "flex-start", maxWidth: "88%", padding: 12, gap: 4, backgroundColor: theme.bubbleThem,
    borderRadius: 14, borderBottomLeftRadius: 4, borderWidth: 1, borderColor: theme.border },
  ownMessage: { alignSelf: "flex-end", backgroundColor: theme.accentWash, borderBottomLeftRadius: 14,
    borderBottomRightRadius: 4, borderColor: theme.accentLine },
  poll: { gap: 6, marginTop: 6 },
  pollEditor: { padding: 12, gap: 6 },
  composer: { paddingHorizontal: 8, paddingTop: 8, backgroundColor: theme.surface, borderTopWidth: 1, borderColor: theme.border },
  menu: { flexDirection: "row", alignItems: "center", padding: 8, gap: 6, backgroundColor: theme.surface },
  fileName: { flex: 1 },
  composerRow: { flexDirection: "row", alignItems: "flex-end", gap: 8 },
  composeInput: { flex: 1, maxHeight: 120 },
});
