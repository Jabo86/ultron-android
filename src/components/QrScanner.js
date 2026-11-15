import React, { useRef, useState } from "react";
import { TouchableOpacity, Text, View, ActivityIndicator, StyleSheet, NativeModules } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { withSystemActivity } from "../lib/lockGuard";
import { theme } from "../theme";

export default function QrScanner({ label, hint, tint, onCode, onFail, testID = "qr-scan" }) {
  const [busy, setBusy] = useState(false);
  const color = tint || theme.primary;

  const pending = useRef(false);
  const run = async () => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    try {
      const value = await withSystemActivity(async () => {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) { onFail?.("perm"); return null; }
        if (!NativeModules.UltronQrScan?.scan) throw new Error("Scanner unavailable");
        return NativeModules.UltronQrScan.scan(label);
      });
      if (value) await onCode?.(value);
    } catch {
      onFail?.("scanner");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };

  return (
    <TouchableOpacity
      style={[st.btn, { borderColor: color + "88", backgroundColor: color + "14" }]}
      onPress={run}
      disabled={busy}
      testID={testID}
    >
      {busy ? <ActivityIndicator color={color} /> : <Ionicons name="qr-code-outline" size={19} color={color} />}
      <View style={{ flex: 1 }}>
        <Text style={[st.txt, { color }]}>{label}</Text>
        {!!hint && <Text style={st.hint}>{busy ? "…" : hint}</Text>}
      </View>
      <Ionicons name="camera-outline" size={18} color={color} />
    </TouchableOpacity>
  );
}

const st = StyleSheet.create({
  btn: {
    flexDirection: "row", alignItems: "center", gap: 10,
    borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 13, marginBottom: 12,
  },
  txt: { fontSize: 14, fontWeight: "700" },
  hint: { color: theme.textDim, fontSize: 11, marginTop: 2, lineHeight: 15 },
});
