import React, { useState } from "react";
import { View, Text, ScrollView, Pressable, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useI18n } from "../lib/i18n";
import { AUDIT_SECTIONS } from "../lib/auditEntries";
import { checkBackupEncryption, checkShield } from "../lib/securityAudit";
import { theme } from "../theme";

export default function SecurityScreen({ navigation }) {
  const { top } = useSafeAreaInsets();
  const { lang } = useI18n();
  const it = lang !== "en";
  const [result, setResult] = useState("");
  const [busy, setBusy] = useState(false);
  const labels = it
    ? { code: "Presente nel codice", device: "Prova sul campo necessaria", missing: "Configurazione mancante", test: "Test locale disponibile" }
    : { code: "Present in code", device: "Field test required", missing: "Missing configuration", test: "Local test available" };

  const run = async () => {
    setBusy(true);
    setResult("");
    await new Promise((resolve) => setTimeout(resolve, 50));
    const checks = [
      [it ? "Scudo" : "Shield", () => {
        const { domains } = checkShield();
        return it ? `${domains} domini caricati` : `${domains} domains loaded`;
      }],
      [it ? "Cifratura backup" : "Backup encryption", () => { checkBackupEncryption(); return it ? "password errata rifiutata" : "wrong password rejected"; }],
    ];
    const lines = checks.map(([title, check]) => {
      try { return title + " · OK · " + check(); }
      catch { return title + (it ? " · test fallito" : " · test failed"); }
    });
    setResult(lines.join("\n"));
    setBusy(false);
  };

  return <ScrollView contentContainerStyle={[s.content, { paddingTop: top + 16 }]}>
    <Pressable accessibilityRole="button" onPress={() => navigation.goBack()} testID="security-back">
      <Text style={s.link}>{it ? "‹ Impostazioni" : "‹ Settings"}</Text>
    </Pressable>
    <Text style={s.title}>{it ? "Sicurezza e audit" : "Security and audit"}</Text>
    <Text style={s.description}>{it
      ? "Controlli locali e stato della configurazione."
      : "Local checks and configuration status."}</Text>
    <Pressable accessibilityRole="button" disabled={busy} onPress={run} testID="security-run-local-audit">
      <Text style={s.link}>{busy ? (it ? "Test in corso…" : "Testing…") : (it ? "Esegui test locali" : "Run local tests")}</Text>
    </Pressable>
    {!!result && <Text accessibilityLiveRegion="polite" style={s.description} testID="security-local-results">{result}</Text>}
    {AUDIT_SECTIONS.map(({ title, rows }) => <View key={title[0]} style={s.section}>
      <Text style={s.heading}>{title[it ? 0 : 1]}</Text>
      {rows.map(([name, english, status, description, translated]) => <View key={name} style={s.card}>
        <Text style={s.item}>{it ? name : english}</Text>
        <Text style={s.status}>{labels[status]}</Text>
        <Text style={s.description}>{it ? description : translated}</Text>
      </View>)}
    </View>)}
  </ScrollView>;
}

const s = StyleSheet.create({
  content: { padding: 20, paddingBottom: 40, gap: 10 },
  link: { color: theme.primary, paddingVertical: 8, fontSize: 15, fontWeight: "700" },
  title: { color: theme.text, fontSize: 26, fontWeight: "800" },
  heading: { color: theme.text, fontSize: 19, fontWeight: "800", marginVertical: 8 },
  section: { gap: 8 },
  card: { backgroundColor: theme.surfaceAlt, borderRadius: 10, padding: 12, gap: 4 },
  item: { color: theme.text, fontSize: 15, fontWeight: "700" },
  status: { color: theme.primary, fontSize: 12 },
  description: { color: theme.textDim, fontSize: 14, lineHeight: 20 },
});
