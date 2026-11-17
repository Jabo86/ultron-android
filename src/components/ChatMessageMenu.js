import React from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { theme } from "../theme";

export default function ChatMessageMenu({ actions, onClose, children }) {
  return <Modal visible transparent animationType="fade" onRequestClose={onClose}>
    <Pressable style={styles.backdrop} onPress={onClose}>
      <Pressable style={styles.sheet}>
        <ScrollView keyboardShouldPersistTaps="handled">
          {children}
          {actions.filter(Boolean).map(({ key, label, icon, action, danger }) => (
            <TouchableOpacity key={key} accessibilityRole="button" testID={key} style={styles.row} onPress={action}>
              <Ionicons name={icon} size={19} color={danger ? theme.danger : theme.text} />
              <Text style={[styles.label, danger && styles.danger]}>{label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </Pressable>
    </Pressable>
  </Modal>;
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "#0009" },
  sheet: { maxHeight: "80%", backgroundColor: theme.surface, borderTopLeftRadius: 20,
    borderTopRightRadius: 20, borderTopWidth: 1, borderColor: theme.border, padding: 14, paddingBottom: 30 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 6, minHeight: 48 },
  label: { flexShrink: 1, color: theme.text, fontSize: 16, fontWeight: "600" },
  danger: { color: theme.danger },
});
