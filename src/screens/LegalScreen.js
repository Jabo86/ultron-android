import React, { useState } from "react";
import { Linking, Pressable, ScrollView, StyleSheet, Text } from "react-native";
import { useI18n } from "../lib/i18n";
import { LEGAL_DOCS, LEGAL_TEXT, legalServerUrl } from "../lib/legalDocuments";
import { theme } from "../theme";

export function LegalDocument({ id, server, onSelect, onClose }) {
  const { lang, t } = useI18n();
  const en = lang === "en";
  const doc = LEGAL_DOCS.find((entry) => entry.id === id);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const url = doc && legalServerUrl(server, doc.path);

  const openServer = async () => {
    setBusy(true);
    setMessage("");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 7000);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) {
        setMessage(en ? `Server document unavailable (HTTP ${response.status}).` : `Documento del gestore non disponibile (HTTP ${response.status}).`);
        return;
      }
      const type = response.headers.get("content-type") || "";
      if (!/^(text\/html|text\/plain|application\/pdf)(?:;|$)/i.test(type)) {
        setMessage(en ? "The server did not return a readable document." : "Il server non ha restituito un documento leggibile.");
        return;
      }
      const destination = response.url || url;
      if (!/^https:\/\//i.test(destination)) throw new Error("Invalid document redirect");
      await Linking.openURL(destination);
    } catch {
      setMessage(en ? "Could not open the server document." : "Impossibile aprire il documento del gestore.");
    } finally {
      clearTimeout(timeout);
      setBusy(false);
    }
  };

  return <ScrollView contentContainerStyle={s.content} testID="legal-document">
    {onClose && <Pressable accessibilityRole="button" onPress={onClose}><Text style={s.link}>{en ? "‹ Back" : "‹ Indietro"}</Text></Pressable>}
    <Text style={s.title}>{doc ? t(doc.key) : (en ? "Document unavailable" : "Documento non disponibile")}</Text>
    {id === "index" ? LEGAL_DOCS.filter((entry) => entry.id !== "index").map((entry) => (
      <Pressable key={entry.id} accessibilityRole="button" onPress={() => onSelect(entry.id)}>
        <Text style={s.link}>{t(entry.key)}</Text>
      </Pressable>
    )) : (LEGAL_TEXT[id]?.[en ? "en" : "it"] || []).map((paragraph, i) => (
      <Text key={i} selectable style={s.paragraph}>{paragraph}</Text>
    ))}
    {doc && id !== "license" && id !== "index" && <Text style={s.note}>{en
      ? "Offline guide. Official service documents depend on the server operator."
      : "Guida consultabile offline. I documenti ufficiali del servizio dipendono dal gestore del server."}</Text>}
    {url && id !== "license" && <Pressable accessibilityRole="button" disabled={busy} onPress={openServer} testID="legal-open-server">
      <Text style={s.link}>{busy ? (en ? "Checking…" : "Verifica…") : (en ? "Open server document" : "Apri documento del gestore")}</Text>
    </Pressable>}
    {!!message && <Text accessibilityLiveRegion="polite" style={s.note}>{message}</Text>}
  </ScrollView>;
}

export default function LegalScreen({ route, navigation }) {
  const { id, server } = route.params || {};
  return <LegalDocument key={id} id={id} server={server} onSelect={(next) => navigation.push("Legal", { id: next, server })} />;
}

const s = StyleSheet.create({
  content: { padding: 20, paddingBottom: 42, gap: 14 },
  title: { color: theme.text, fontSize: 24, fontWeight: "800" },
  paragraph: { color: theme.text, fontSize: 15, lineHeight: 23 },
  note: { color: theme.textDim, fontSize: 13, lineHeight: 20 },
  link: { color: theme.primary, fontSize: 15, fontWeight: "700", paddingVertical: 6 },
});
