import React, { useState } from "react";
import { Modal, StyleSheet, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Text } from "./HudText";
import { useI18n } from "../lib/i18n";
import { theme } from "../theme";

export default function EncryptionNotice({ kind = "chat" }) {
  const [open, setOpen] = useState(false);
  const { t } = useI18n();
  const call = kind === "call" || kind === "group-call";
  const title = t(call ? "encryption.call" : "encryption.chat");
  const description = t(kind === "group-call" ? "encryption.groupCallInfo" : kind === "call" ? "encryption.callInfo" : kind === "group" ? "encryption.groupInfo" : "encryption.chatInfo");
  return <>
    <TouchableOpacity style={s.notice} accessibilityRole="button" accessibilityLabel={title} onPress={()=>setOpen(true)} testID={`e2ee-notice-${kind}`}>
      <Ionicons name="lock-closed-outline" size={13} color={theme.accent}/>
      <Text style={s.label}>{title} · E2EE</Text>
      <Ionicons name="information-circle-outline" size={15} color={theme.accent}/>
    </TouchableOpacity>
    <Modal visible={open} transparent animationType="fade" onRequestClose={()=>setOpen(false)}>
      <View style={s.overlay}>
        <View style={s.card} accessibilityViewIsModal>
          <Ionicons name="shield-checkmark-outline" size={32} color={theme.accent}/>
          <Text style={s.title}>{title}</Text>
          <Text style={s.body}>{description}</Text>
          <TouchableOpacity style={s.close} accessibilityRole="button" onPress={()=>setOpen(false)}><Text style={s.closeText}>{t("encryption.close")}</Text></TouchableOpacity>
        </View>
      </View>
    </Modal>
  </>;
}
const s=StyleSheet.create({
  notice:{flexDirection:"row",alignItems:"center",justifyContent:"center",gap:7,paddingHorizontal:14,paddingVertical:10,minHeight:44,backgroundColor:"#001b29b8"},
  label:{fontSize:11,lineHeight:16,color:theme.textDim,flexShrink:1,textAlign:"center"},
  overlay:{flex:1,justifyContent:"center",padding:24,backgroundColor:"#000000c9"},
  card:{padding:22,borderWidth:1,borderColor:theme.accent,backgroundColor:"#00121c",borderTopLeftRadius:22,borderBottomRightRadius:22},
  title:{fontSize:18,lineHeight:25,color:theme.text,marginTop:12},body:{fontSize:14,lineHeight:22,color:theme.textDim,marginTop:14},
  close:{minHeight:48,alignItems:"center",justifyContent:"center",marginTop:20,borderWidth:1,borderColor:theme.accent,borderRadius:14},closeText:{color:theme.text,fontSize:15},
});
