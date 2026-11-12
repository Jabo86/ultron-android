import React, { useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "../theme";
import { useI18n } from "../lib/i18n";
import { getServerUrl } from "../lib/api";
import { LegalDocument } from "./LegalScreen";

export default function ConsentScreen({ onAccept }) {
  const { t, lang } = useI18n();
  const en = lang === "en";
  const [document, setDocument] = useState(null);
  const insets = useSafeAreaInsets();
  const [privacy, setPrivacy] = useState(false);
  const [terms, setTerms] = useState(false);
  const ready = privacy && terms;

  if (document) return <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
    <LegalDocument key={document} id={document} server={getServerUrl()} onClose={() => setDocument(null)} />
  </View>;

  const Check = ({ value, onToggle, label, testID }) => (
    <TouchableOpacity style={styles.checkRow} onPress={() => onToggle(!value)} activeOpacity={0.7} testID={testID}>
      <Ionicons name={value ? "checkbox" : "square-outline"} size={22} color={value ? theme.primary : theme.textFaint} />
      <Text style={styles.checkLabel}>{label}</Text>
    </TouchableOpacity>
  );

  return (
    <View style={[styles.root, { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 20 }]}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.logo}><Ionicons name="shield-checkmark-outline" size={34} color={theme.primary} /></View>
        <Text style={styles.title}>{t("consent.title")}</Text>
        <Text style={styles.intro}>{en ? "Read the privacy information and usage rules. Official documents depend on the server you use." : "Leggi le informazioni sulla privacy e le regole d’uso. I documenti ufficiali dipendono dal server che usi."}</Text>

        <TouchableOpacity style={styles.link} onPress={() => setDocument("privacy")} testID="consent-open-privacy">
          <Ionicons name="shield-checkmark-outline" size={18} color={theme.primary} />
          <Text style={styles.linkTxt}>{t("consent.readPrivacy")}</Text>
          <Ionicons name="open-outline" size={16} color={theme.textFaint} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.link} onPress={() => setDocument("terms")} testID="consent-open-terms">
          <Ionicons name="document-text-outline" size={18} color={theme.primary} />
          <Text style={styles.linkTxt}>{t("consent.readTerms")}</Text>
          <Ionicons name="open-outline" size={16} color={theme.textFaint} />
        </TouchableOpacity>

        <View style={styles.divider} />
        <Check value={privacy} onToggle={setPrivacy} label={en ? "I have read the privacy information" : "Ho letto le informazioni sulla privacy"} testID="consent-check-privacy" />
        <Check value={terms} onToggle={setTerms} label={en ? "I accept the general usage rules" : "Accetto le regole generali d’uso"} testID="consent-check-terms" />
      </ScrollView>

      <TouchableOpacity
        style={[styles.cta, !ready && styles.ctaDisabled]}
        disabled={!ready}
        onPress={onAccept}
        testID="consent-continue"
      >
        <Text style={styles.ctaTxt}>{t("consent.continue")}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "transparent", paddingHorizontal: 22 },
  scroll: { paddingBottom: 20 },
  logo: { width: 64, height: 64, borderRadius: 18, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, alignItems: "center", justifyContent: "center", marginBottom: 18 },
  title: { color: theme.text, fontSize: 26, fontWeight: "800" },
  intro: { color: theme.textDim, fontSize: 14, lineHeight: 21, marginTop: 12 },
  link: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, borderRadius: 12, padding: 14, marginTop: 12 },
  linkTxt: { color: theme.text, fontSize: 14, fontWeight: "600", flex: 1 },
  divider: { height: 1, backgroundColor: theme.border, marginVertical: 20 },
  checkRow: { flexDirection: "row", alignItems: "flex-start", gap: 12, paddingVertical: 10 },
  checkLabel: { color: theme.text, fontSize: 14, flex: 1, lineHeight: 20 },
  controller: { color: theme.textFaint, fontSize: 12, marginTop: 16 },
  cta: { backgroundColor: theme.primary, borderRadius: 14, paddingVertical: 16, alignItems: "center", marginTop: 12 },
  ctaDisabled: { opacity: 0.4 },
  ctaTxt: { color: "#fff", fontSize: 16, fontWeight: "800" },
});
