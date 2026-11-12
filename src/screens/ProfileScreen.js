import React, { useEffect, useRef, useState } from "react";
import { withSystemActivity } from "../lib/lockGuard";
import { ActivityIndicator, Image, Pressable, ScrollView, Share, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { pickAvatarDataUrl } from "../lib/avatar";
import { useAuth } from "../context/AuthContext";
import { useI18n } from "../lib/i18n";
import * as api from "../lib/api";
import { getBlob, setBlob } from "../lib/lock";
import { PROFILE_LIMITS, profileDraft, publicProfile, validAvatar } from "../lib/profilePrivacy";
import { theme } from "../theme";

function ContactProfile({ peer, it }) {
  const [state, setState] = useState(null);
  useEffect(() => {
    let active = true;
    setState(null);
    api.contactProfile(peer).then((profile) => {
      if (active) setState(profile?.lns === peer && profile?.is_public === true ? profile : {});
    }).catch(() => { if (active) setState({ unavailable: true }); });
    return () => { active = false; };
  }, [peer]);
  return <ScrollView contentContainerStyle={s.content}>
    <Text style={s.name}>{peer}</Text>
    {!state ? <ActivityIndicator color={theme.primary} /> : <>
      {validAvatar(state.avatar) && <Image style={s.avatar} source={{ uri: state.avatar }} />}
      {!!state.headline && <Text style={s.text}>{state.headline}</Text>}
      {!!state.bio && <Text style={s.text}>{state.bio}</Text>}
      {!state.headline && !state.bio && !validAvatar(state.avatar) && <Text style={s.hint}>
        {state.unavailable
          ? (it ? "Profilo non disponibile su questo server." : "Profile unavailable on this server.")
          : (it ? "Nessun dettaglio pubblico." : "No public details.")}
      </Text>}
    </>}
  </ScrollView>;
}

function EditProfile({ user, it }) {
  const key = `profile-v1:${user.server || api.getServerUrl()}:${user.lns}`;
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const edited = useRef(false);
  useEffect(() => {
    let active = true;
    getBlob(key).catch(() => null).then(async (local) => {
      if (!active) return;
      setDraft((previous) => previous || profileDraft(local));
      try {
        const remote = await api.myProfile();
        if (active && !local && !edited.current) setDraft(profileDraft(null, remote));
      } catch {
        if (active && !edited.current) setMessage(it ? "Profilo locale disponibile. La pubblicazione richiede il supporto del server." : "Local profile available. Publishing requires server support.");
      }
    });
    return () => { active = false; };
  }, [key, it]);

  const change = (field, value) => {
    edited.current = true;
    setDraft((previous) => ({ ...previous, [field]: value }));
  };
  const pick = async () => {
    setBusy(true);
    try {
      const result = await withSystemActivity(() => pickAvatarDataUrl({ allowOriginal: false }));
      if (result.denied || result.error || (result.dataUrl && !validAvatar(result.dataUrl))) {
        setMessage(it ? "Foto non disponibile. Controlla i permessi o scegli un’immagine più piccola." : "Photo unavailable. Check permissions or choose a smaller image.");
      } else if (result.dataUrl) change("avatar", result.dataUrl);
    } catch {
      setMessage(it ? "Impossibile leggere la foto." : "Could not read the photo.");
    } finally { setBusy(false); }
  };

  const save = async () => {
    setBusy(true);
    setMessage("");
    try {
      await setBlob(key, draft);
    } catch {
      setMessage(it ? "Salvataggio locale non riuscito." : "Could not save locally.");
      setBusy(false);
      return;
    }
    try {
      const published = publicProfile(draft);
      await api.saveProfile(published);
      const actual = await api.myProfile();
      if (actual?.is_public !== published.is_public ||
          ["headline", "bio", "avatar"].some((field) => (actual[field] || "") !== published[field])) {
        throw new Error("Visibility not confirmed");
      }
      setMessage(it ? "Profilo salvato. Visibilità confermata dal server." : "Profile saved. Visibility confirmed by the server.");
    } catch {
      setMessage(it
        ? "Profilo salvato sul telefono. Il server non ha confermato la visibilità: una versione pubblicata in precedenza potrebbe essere ancora visibile."
        : "Profile saved on this phone. The server did not confirm visibility. Previously published details may still be visible.");
    } finally { setBusy(false); }
  };

  if (!draft) return <ActivityIndicator style={s.loading} color={theme.primary} />;
  const visibility = (field, title) => <View style={s.row}>
    <Text style={s.text}>{title} · {draft.visibility[field] ? (it ? "Pubblica" : "Public") : (it ? "Privata" : "Private")}</Text>
    <Switch accessibilityLabel={title} value={draft.visibility[field]} disabled={busy}
      onValueChange={(value) => {
        edited.current = true;
        setDraft((previous) => ({ ...previous, visibility: { ...previous.visibility, [field]: value } }));
      }}
      testID={`profile-visibility-${field}`} />
  </View>;
  return <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.content}>
    <Text style={s.name}>{user.lns}</Text>
    <Text style={s.hint}>{it
      ? "I dettagli privati restano cifrati su questo telefono. I dettagli pubblici possono essere letti dal server e dagli utenti che conoscono il tuo indirizzo."
      : "Private details stay encrypted on this phone. The server and users who know your address can read public details."}</Text>
    {draft.avatar ? <Image source={{ uri: draft.avatar }} style={s.avatar} /> : null}
    <Pressable accessibilityRole="button" disabled={busy} onPress={pick} testID="profile-avatar-btn">
      <Text style={s.link}>{it ? "Scegli foto" : "Choose photo"}</Text>
    </Pressable>
    {!!draft.avatar && <Pressable accessibilityRole="button" disabled={busy} onPress={() => change("avatar", "")}>
      <Text style={s.link}>{it ? "Rimuovi foto" : "Remove photo"}</Text>
    </Pressable>}
    {visibility("avatar", it ? "Foto" : "Photo")}
    {visibility("headline", it ? "Informazioni" : "About")}
    <TextInput style={s.input} editable={!busy} value={draft.headline} onChangeText={(value) => change("headline", value)}
      maxLength={PROFILE_LIMITS.headline} placeholder={it ? "Informazioni" : "About"} placeholderTextColor={theme.textDim}
      testID="profile-headline" />
    {visibility("bio", "Bio")}
    <TextInput style={[s.input, s.bio]} editable={!busy} value={draft.bio} onChangeText={(value) => change("bio", value)}
      maxLength={PROFILE_LIMITS.bio} multiline placeholder="Bio" placeholderTextColor={theme.textDim} testID="profile-bio" />
    <Pressable accessibilityRole="button" disabled={busy} style={s.save} onPress={save} testID="profile-save">
      <Text style={s.text}>{busy ? (it ? "Attendi…" : "Please wait…") : (it ? "Salva profilo" : "Save profile")}</Text>
    </Pressable>
    {!!message && <Text accessibilityLiveRegion="polite" style={s.hint}>{message}</Text>}
    <Pressable accessibilityRole="button" onPress={() => Share.share({ message: user.lns }).catch(() => {})}>
      <Text style={s.link}>{it ? "Condividi il mio indirizzo" : "Share my address"}</Text>
    </Pressable>
  </ScrollView>;
}

export default function ProfileScreen({ route }) {
  const { user } = useAuth();
  const { lang } = useI18n();
  const peer = route?.params?.peer;
  if (!user) return null;
  return peer && peer !== user.lns ? <ContactProfile peer={peer} it={lang !== "en"} />
    : <EditProfile key={`${user.server}:${user.lns}`} user={user} it={lang !== "en"} />;
}

const s = StyleSheet.create({
  content: { padding: 20, paddingBottom: 40, gap: 12 },
  name: { color: theme.text, fontSize: 20, fontWeight: "800" },
  text: { color: theme.text, fontSize: 15 },
  hint: { color: theme.textDim, fontSize: 13, lineHeight: 20 },
  link: { color: theme.primary, fontSize: 15, paddingVertical: 4 },
  loading: { marginTop: 25 },
  avatar: { width: 100, height: 100, borderRadius: 50 },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  input: { backgroundColor: theme.surfaceAlt, color: theme.text, borderWidth: 1, borderColor: theme.border, borderRadius: 10, padding: 12 },
  bio: { minHeight: 90, textAlignVertical: "top" },
  save: { alignItems: "center", backgroundColor: theme.surfaceAlt, borderColor: theme.primary, borderWidth: 1, padding: 14, borderRadius: 10 },
});
