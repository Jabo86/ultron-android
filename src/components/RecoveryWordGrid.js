import React, { useRef, useState } from "react";
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "../theme";

export const emptyRecoveryWords = () => Array(12).fill("");

export default function RecoveryWordGrid({ words, onChange, onSubmit, editable = true, italian = false }) {
  const [visible, setVisible] = useState(false);
  const inputs = useRef([]);
  const writing = !!onChange;
  const action = visible ? (italian ? "Nascondi parole" : "Hide words") : (italian ? "Mostra parole" : "Show words");

  const focusNext = (index) => {
    if (index < words.length - 1) inputs.current[index + 1]?.focus();
    else onSubmit?.();
  };

  const change = (index, text) => {
    const tokens = text.slice(0, 2048).trim().toLowerCase().split(/\s+/);
    if (tokens.length > words.length - index || tokens.some(word => !/^[a-z]{0,16}$/.test(word))) return;
    const updated = [...words];
    tokens.forEach((word, offset) => { updated[index + offset] = word; });
    onChange(updated);
    const last = index + tokens.length - 1;
    if (tokens[0] && /\s$/.test(text) && last < words.length - 1) inputs.current[last + 1]?.focus();
  };

  return (
    <View style={styles.root}>
      <TouchableOpacity style={styles.visibility} onPress={() => setVisible(value => !value)}
        accessibilityRole="button" accessibilityLabel={action} testID="recovery-visibility">
        <Ionicons name={visible ? "eye-off-outline" : "eye-outline"} size={20} color={theme.primary} />
        <Text style={styles.visibilityText}>{action}</Text>
      </TouchableOpacity>
      <View style={styles.grid}>
        {words.map((word, index) => (
          <View key={index} style={styles.cell}>
            <Text style={styles.number} importantForAccessibility="no">{index + 1}</Text>
            {writing ? (
              <TextInput ref={input => { inputs.current[index] = input; }} style={styles.word}
                value={word} onChangeText={text => change(index, text)} editable={editable}
                returnKeyType={index === words.length - 1 ? "done" : "next"} submitBehavior="submit"
                onSubmitEditing={() => focusNext(index)} secureTextEntry={!visible}
                autoCapitalize="none" autoCorrect={false} spellCheck={false}
                autoComplete="off" importantForAutofill="no" allowFontScaling
                accessibilityLabel={italian ? `Parola ${index + 1}` : `Word ${index + 1}`}
                testID={`recovery-word-${index + 1}`} />
            ) : <Text style={styles.word}>{visible ? word : "••••••"}</Text>}
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { marginVertical: 12 },
  visibility: { minHeight: 44, flexDirection: "row", alignSelf: "flex-end", alignItems: "center", gap: 8, paddingHorizontal: 6 },
  visibilityText: { color: theme.primary, fontSize: 13, fontWeight: "700" },
  grid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: 8 },
  cell: { width: "48.5%", flexDirection: "row", alignItems: "center", minHeight: 48, paddingHorizontal: 9,
    backgroundColor: theme.surface, borderRadius: 12, borderWidth: 1, borderColor: theme.border },
  number: { width: 24, color: theme.primary, fontSize: 12, fontWeight: "700", fontVariant: ["tabular-nums"] },
  word: { flex: 1, minWidth: 0, color: theme.text, fontSize: 15, paddingVertical: 8, paddingHorizontal: 0 },
});
