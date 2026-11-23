import React, { useState } from "react";
import { Modal, StyleSheet, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Text } from "./HudText";
import { useI18n } from "../lib/i18n";
import { theme } from "../theme";

export default function EncryptionNotice({ kind = "chat" }) {
  const [open, setOpen] = useState(false);
  const { lang } = useI18n();
  const it = lang !== "en";
  const call = kind === "call" || kind === "group-call";
  const title = call
    ? (it ? "Chiamata con cifratura end-to-end" : "End-to-end encrypted call")
    : (it ? "Messaggi e allegati con cifratura end-to-end" : "End-to-end encrypted messages and attachments");
  const description = kind === "group-call"
    ? (it ? "Questa chiamata usa connessioni WebRTC cifrate con DTLS-SRTP tra i dispositivi. Il relay inoltra i flussi cifrati e può vedere gli IP delle connessioni. La cifratura del collegamento e la verifica dell’identità dei partecipanti sono controlli distinti."
      : "This call uses WebRTC connections encrypted with DTLS-SRTP between devices. The relay forwards encrypted streams and can see connection IP addresses. Connection encryption and verification of participants’ identities are separate checks.")
    : call
    ? (it ? "L’audio viene cifrato tra i telefoni con WebRTC e DTLS-SRTP. Il relay TURN inoltra l’audio cifrato senza decifrarlo. Confronta le emoji di sicurezza con l’altra persona per verificare la chiamata. Il relay può vedere gli IP delle connessioni."
      : "Audio is encrypted between the phones using WebRTC and DTLS-SRTP. The TURN relay forwards encrypted audio without decrypting it. Compare the security emojis with the other person to verify the call. The relay can see connection IP addresses.")
    : kind === "group"
      ? (it ? "Nei gruppi MLS, messaggi e allegati vengono cifrati sui dispositivi e aperti dai membri autorizzati. Il gateway riceve contenuti cifrati. La cifratura end-to-end non nasconde da sola i metadati e non impedisce a un partecipante di conservare una copia."
        : "In MLS groups, messages and attachments are encrypted on devices and opened by authorized members. The gateway receives encrypted content. End-to-end encryption alone does not hide metadata or prevent a participant from keeping a copy.")
      : (it ? "Messaggi e allegati vengono cifrati sul telefono prima dell’invio e decifrati sui dispositivi dei partecipanti. Il gateway inoltra contenuti cifrati. Verifica le chiavi del contatto con lo scudo della chat. La cifratura end-to-end non rende anonimi i metadati della connessione."
        : "Messages and attachments are encrypted on the phone before sending and decrypted on participants’ devices. The gateway forwards encrypted content. Verify your contact’s keys using the chat shield. End-to-end encryption does not make connection metadata anonymous.");
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
          <TouchableOpacity style={s.close} accessibilityRole="button" onPress={()=>setOpen(false)}><Text style={s.closeText}>{it?"Ho capito":"Got it"}</Text></TouchableOpacity>
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
