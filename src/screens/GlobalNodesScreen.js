import React, { useCallback, useMemo, useState } from "react";
import { Alert, ScrollView, StyleSheet, TouchableOpacity, View } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { Text } from "../components/HudText";
import { theme } from "../theme";
import { useTint } from "../lib/appearance";
import { addGlobalNode, checkGlobalNode, listGlobalNodes, removeGlobalNode, validateGlobalNodeProfile } from "../lib/globalNodes";
import { withSystemActivity } from "../lib/lockGuard";

export default function GlobalNodesScreen() {
  const tint = useTint();
  const styles = useMemo(() => makeStyles(tint), [tint]);
  const [nodes, setNodes] = useState([]);
  const [states, setStates] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(() => {
    let active = true;
    listGlobalNodes().then(value => { if (active) setNodes(value); })
      .catch(() => { if (active) setError("Non riesco a leggere i profili nodo salvati."); });
    return () => { active = false; };
  }, []);
  useFocusEffect(refresh);

  async function importNode() {
    if (busy) return;
    setBusy(true); setError("");
    let uri;
    try {
      const result = await withSystemActivity(() => DocumentPicker.getDocumentAsync({
        type: ["application/json", "text/json"], copyToCacheDirectory: true,
      }));
      if (result.canceled) return;
      uri = result.assets?.[0]?.uri;
      const info = await FileSystem.getInfoAsync(uri);
      if (!info.exists || !Number.isSafeInteger(info.size) || info.size > 64 * 1024) {
        throw new Error("Il profilo nodo supera il limite di dimensione.");
      }
      const profile = validateGlobalNodeProfile(JSON.parse(await FileSystem.readAsStringAsync(uri)));
      const next = await addGlobalNode(profile);
      setNodes(next);
      setStates(current => ({ ...current, [profile.nodeId]: "Profilo salvato · connessione da verificare" }));
    } catch (failure) {
      setError(failure?.message || "Impossibile importare il profilo nodo.");
    } finally {
      if (uri && uri.startsWith(FileSystem.cacheDirectory || "\0")) {
        await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
      }
      setBusy(false);
    }
  }

  async function verify(node) {
    setStates(current => ({ ...current, [node.nodeId]: "Verifica HTTPS e impronta TLS…" }));
    try {
      const result = await checkGlobalNode(node);
      setStates(current => ({ ...current, [node.nodeId]: `Connesso · ${result.protocol}` }));
      setError("");
    } catch (failure) {
      setStates(current => ({ ...current, [node.nodeId]: "Verifica non riuscita" }));
      setError(failure?.message || "Verifica del relay non riuscita.");
    }
  }

  function forget(node) {
    Alert.alert("Rimuovere il nodo?", "Il profilo pubblico verrà eliminato da questo dispositivo.", [
      { text: "Annulla", style: "cancel" },
      { text: "Rimuovi", style: "destructive", onPress: async () => setNodes(await removeGlobalNode(node.nodeId)) },
    ]);
  }

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content}>
      <View style={styles.hero}>
        <View style={styles.heroIcon}><Ionicons name="git-network-outline" size={25} color={tint} /></View>
        <Text style={styles.title}>Nodi globali</Text>
        <Text style={styles.subtitle}>
          Importa un profilo pubblico del nodo e verifica HTTPS con il certificato fissato. Il profilo non contiene chiavi private.
        </Text>
      </View>

      <View style={styles.notice}>
        <Ionicons name="information-circle-outline" size={20} color={theme.primary} />
        <Text style={styles.noticeText}>
          Fase pilota: qui verifichi identità e connessione del relay. Le chat continuano a usare il percorso attuale finché la consegna ai telefoni non è completata.
        </Text>
      </View>

      <TouchableOpacity disabled={busy} onPress={importNode} style={[styles.primary, busy && { opacity: 0.6 }]} testID="global-nodes-import">
        <Ionicons name="cloud-download-outline" size={20} color="#fff" />
        <Text style={styles.primaryText}>{busy ? "Importazione…" : "Importa profilo nodo"}</Text>
      </TouchableOpacity>

      {!!error && <Text style={styles.error}>{error}</Text>}

      {nodes.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="server-outline" size={28} color={theme.textFaint} />
          <Text style={styles.emptyTitle}>Nessun nodo configurato</Text>
          <Text style={styles.emptyText}>Il gestore del nodo può creare e condividere il profilo dal Terminale.</Text>
        </View>
      ) : nodes.map(node => (
        <View key={node.nodeId} style={styles.card}>
          <View style={styles.cardHead}>
            <View style={styles.nodeIcon}><Ionicons name="server-outline" size={19} color={tint} /></View>
            <View style={styles.cardInfo}>
              <Text style={styles.nodeName}>{node.name || "Relay UNVOR"}</Text>
              <Text style={styles.endpoint}>{node.url}</Text>
              <Text style={styles.nodeId}>ID {node.nodeId.slice(0, 16)}…</Text>
            </View>
            <TouchableOpacity onPress={() => forget(node)} accessibilityLabel="Rimuovi nodo" style={styles.iconButton}>
              <Ionicons name="trash-outline" size={19} color={theme.danger} />
            </TouchableOpacity>
          </View>
          <Text style={styles.status}>{states[node.nodeId] || "Profilo salvato · non ancora verificato"}</Text>
          <TouchableOpacity onPress={() => verify(node)} style={styles.secondary} testID={`global-node-check-${node.nodeId}`}>
            <Ionicons name="shield-checkmark-outline" size={18} color={tint} />
            <Text style={styles.secondaryText}>Verifica nodo</Text>
          </TouchableOpacity>
        </View>
      ))}
    </ScrollView>
  );
}

function makeStyles(tint) {
  return StyleSheet.create({
    page: { flex: 1, backgroundColor: theme.bg },
    content: { padding: 18, paddingBottom: 36, gap: 14 },
    hero: { alignItems: "center", paddingVertical: 18 },
    heroIcon: { width: 54, height: 54, borderRadius: 18, backgroundColor: tint + "20", alignItems: "center", justifyContent: "center", marginBottom: 12 },
    title: { color: theme.text, fontSize: 24, fontWeight: "800", textAlign: "center" },
    subtitle: { color: theme.textDim, fontSize: 14, lineHeight: 21, textAlign: "center", marginTop: 8, maxWidth: 520 },
    notice: { flexDirection: "row", alignItems: "flex-start", gap: 10, padding: 13, borderRadius: 14, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border },
    noticeText: { color: theme.textDim, fontSize: 13, lineHeight: 19, flex: 1 },
    primary: { minHeight: 50, borderRadius: 14, backgroundColor: tint, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 9 },
    primaryText: { color: "#fff", fontSize: 15, fontWeight: "800" },
    error: { color: theme.danger, fontSize: 13, lineHeight: 19, paddingHorizontal: 4 },
    empty: { minHeight: 180, borderRadius: 18, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, alignItems: "center", justifyContent: "center", padding: 22, gap: 8 },
    emptyTitle: { color: theme.text, fontSize: 16, fontWeight: "700" },
    emptyText: { color: theme.textDim, fontSize: 13, lineHeight: 19, textAlign: "center" },
    card: { borderRadius: 18, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, padding: 15, gap: 11 },
    cardHead: { flexDirection: "row", alignItems: "center", gap: 11 },
    nodeIcon: { width: 40, height: 40, borderRadius: 13, backgroundColor: tint + "20", alignItems: "center", justifyContent: "center" },
    cardInfo: { flex: 1 },
    nodeName: { color: theme.text, fontSize: 15, fontWeight: "800" },
    endpoint: { color: theme.textDim, fontSize: 12, marginTop: 3 },
    nodeId: { color: theme.textFaint, fontSize: 10, marginTop: 3, fontFamily: "monospace" },
    iconButton: { padding: 8 },
    status: { color: theme.textDim, fontSize: 12 },
    secondary: { minHeight: 42, borderRadius: 12, borderWidth: 1, borderColor: tint + "70", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
    secondaryText: { color: tint, fontSize: 13, fontWeight: "800" },
  });
}
