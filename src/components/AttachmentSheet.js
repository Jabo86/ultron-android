import React from "react";
import { StyleSheet, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Text } from "./HudText";
import { theme } from "../theme";

export default function AttachmentSheet({ items, disabled, testID, limitLabel }) {
  return <View style={s.sheet} testID={testID}>
    <View style={s.handle}/>
    <Text style={s.limit}>{limitLabel}</Text>
    <View style={s.grid}>{items.map(item=><TouchableOpacity key={item.id} testID={item.id}
      accessibilityRole="button" accessibilityLabel={item.label} disabled={disabled}
      onPress={item.action} style={[s.item,disabled&&s.disabled]}>
      <View style={s.pill}><Ionicons name={item.icon} size={28} color={item.color || theme.accent}/></View>
      <Text style={s.label}>{item.label}</Text>
    </TouchableOpacity>)}</View>
  </View>;
}
const s=StyleSheet.create({
  sheet:{backgroundColor:"#071a26",borderTopLeftRadius:30,borderTopRightRadius:30,borderWidth:1,borderBottomWidth:0,borderColor:"#155B75",paddingTop:10,paddingBottom:12},
  handle:{alignSelf:"center",width:44,height:4,borderRadius:2,backgroundColor:"#7bafb9",marginBottom:10},
  limit:{fontSize:11,color:theme.textDim,textAlign:"center",marginBottom:8},
  grid:{flexDirection:"row",flexWrap:"wrap",paddingHorizontal:6},item:{width:"25%",minHeight:90,alignItems:"center",paddingVertical:6,paddingHorizontal:3},
  pill:{width:"90%",height:48,borderRadius:26,borderWidth:1,borderColor:"#244957",backgroundColor:"#00111c",alignItems:"center",justifyContent:"center"},
  label:{fontSize:12,lineHeight:16,textAlign:"center",color:theme.textDim,marginTop:7},disabled:{opacity:0.4},
});
