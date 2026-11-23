import React, { useCallback, useEffect, useState } from "react";
import { Image, ScrollView, StyleSheet, TouchableOpacity, View, useWindowDimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { Text } from "../components/HudText";
import { useAuth } from "../context/AuthContext";
import { useUnread } from "../context/UnreadContext";
import { useI18n } from "../lib/i18n";
import { theme } from "../theme";
import { useFocusEffect } from "@react-navigation/native";
import { getBlob } from "../lib/lock";
import { validAvatar } from "../lib/profilePrivacy";

export default function UnvorHomeScreen({ navigation }) {
  const { user } = useAuth();
  const { height } = useWindowDimensions();
  const { chatUnread, bookRequests } = useUnread();
  const { lang, t } = useI18n();
  const profileKey = user?.lns && user?.server ? `profile-v1:${user.server}:${user.lns}` : null;
  const [photo, setPhoto] = useState(null);
  useFocusEffect(useCallback(() => {
    let active = true;
    if (profileKey) getBlob(profileKey).then(profile => {
      if (active) setPhoto({ key: profileKey, uri: validAvatar(profile?.avatar) ? profile.avatar : null });
    }).catch(() => { if (active) setPhoto({ key: profileKey, uri: null }); });
    return () => { active = false; };
  }, [profileKey]));
  const avatar = photo?.key === profileKey ? photo?.uri : null;
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const timer=setInterval(()=>setNow(new Date()),30000); return ()=>clearInterval(timer); },[]);
  const local = lang === "it";
  const tiles = [
    {label:t("tab.conversations"), icon:"chatbubbles-outline", count:chatUnread, action:()=>navigation.navigate("Conversazioni")},
    {label:t("tab.rubrica"), icon:"people-outline", count:bookRequests, action:()=>navigation.navigate("Rubrica")},
    {label:local?"Gruppi":"Groups", icon:"planet-outline", action:()=>navigation.navigate("PilotGroups")},
    {label:local?"Chiamate":"Calls", icon:"call-outline", action:()=>navigation.navigate("CallLog")},
  ];
  return <View style={s.root}>
    <Image source={require("../../assets/unvor/background.webp")} style={StyleSheet.absoluteFill} resizeMode="cover" accessibilityIgnoresInvertColors />
    <SafeAreaView style={s.safe} edges={["top", "bottom"]}>
      <ScrollView contentContainerStyle={[s.content,{minHeight:height-70}]} showsVerticalScrollIndicator={false}>
        <View style={s.top}>
          <View style={[s.panel,s.clockPanel]}>
            <Text style={s.clock} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.72}>{now.toLocaleTimeString(lang,{hour:"2-digit",minute:"2-digit"})}</Text>
            <Text style={s.date} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>{now.toLocaleDateString(lang,{weekday:"short",day:"numeric",month:"short",year:"numeric"})}</Text>
            <View style={s.edge}/>
          </View>
          <View style={[s.panel,s.account]}>
            <TouchableOpacity style={s.profileButton} accessibilityRole="button" accessibilityLabel={local?"Apri il tuo profilo":"Open your profile"} onPress={()=>navigation.navigate("Profilo",{lns:user?.lns})}>
              {avatar ? <Image source={{uri:avatar}} style={s.avatar} resizeMode="cover" /> : <View style={s.avatarFallback}><Ionicons name="person-outline" size={26} color={theme.accent}/></View>}
              <Text style={s.accountName} numberOfLines={1}>{user?.lns?.split("@")[0] || "UNVOR"}</Text>
            </TouchableOpacity>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel={t("tab.settings")} onPress={()=>navigation.navigate("Impostazioni")} style={s.settingsButton}>
              <Ionicons name="settings-outline" size={24} color={theme.accent}/>
            </TouchableOpacity>
            <View style={s.edge}/>
          </View>
        </View>
        <View style={[s.hero,{height:Math.max(250,Math.min(300,height*.29))}]}>
          <View style={s.ring}/><View style={s.innerRing}/>
          <Image source={require("../../assets/unvor/emblem.webp")} style={s.emblem} resizeMode="contain" accessibilityLabel="UNVOR"/>
        </View>
        <Text style={s.wordmark}>UNVOR</Text>
        <Text style={s.description}>{t("unvor.intro")}</Text>
        <View style={s.tiles}>{tiles.map(tile=><TouchableOpacity key={tile.label} testID={`unvor-home-${tile.icon}`} style={[s.panel,s.tile]} onPress={tile.action} accessibilityRole="button" accessibilityLabel={tile.count?`${tile.label}, ${tile.count}`:tile.label}>
          <Ionicons name={tile.icon} size={26} color="#BFF7FF"/>{tile.count>0&&<View style={s.badge}><Text style={s.badgeText}>{tile.count>99?"99+":tile.count}</Text></View>}
          <Text style={s.tileLabel}>{tile.label}</Text><View style={s.edge}/>
        </TouchableOpacity>)}</View>
        <TouchableOpacity style={s.search} testID="unvor-home-search" onPress={()=>navigation.navigate("GlobalSearch")} accessibilityRole="button"><Ionicons name="search-outline" size={23} color={theme.accent}/><Text style={s.searchText}>{local?"Cerca messaggi, file, contatti, gruppi…":"Search messages, files, contacts, groups…"}</Text><Ionicons name="arrow-forward" size={20} color={theme.text}/></TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  </View>;
}
const s=StyleSheet.create({
 root:{flex:1,backgroundColor:theme.bg},safe:{flex:1},content:{flexGrow:1,paddingHorizontal:18,paddingTop:12,paddingBottom:22},
 panel:{height:86,borderWidth:1,borderColor:"#155B75",backgroundColor:"#00121be8",borderTopLeftRadius:16,borderBottomRightRadius:16,position:"relative"},
 top:{flexDirection:"row",alignItems:"stretch",gap:10},clockPanel:{flex:1,minWidth:0,padding:8,justifyContent:"center"},clock:{fontSize:36,lineHeight:40,color:theme.text,fontWeight:"300"},date:{fontSize:14,lineHeight:18,color:theme.textDim,marginTop:3},
 account:{flex:1,minWidth:0,padding:8,flexDirection:"row",gap:4,alignItems:"center"},accountName:{fontSize:12,lineHeight:16,color:theme.text,marginTop:3,maxWidth:"100%"},profileButton:{flex:1,minWidth:0,alignItems:"center",justifyContent:"center",minHeight:68},avatar:{width:44,height:44,borderRadius:22,borderWidth:1,borderColor:theme.accent},avatarFallback:{width:44,height:44,borderRadius:22,borderWidth:1,borderColor:theme.accent,alignItems:"center",justifyContent:"center",backgroundColor:"#001c2a"},settingsButton:{alignItems:"center",justifyContent:"center",height:44,width:44},
 hero:{height:210,marginTop:10,alignItems:"center",justifyContent:"center"},ring:{position:"absolute",width:240,height:240,borderRadius:120,borderWidth:2,borderColor:"#29CFE4",backgroundColor:"#00131a66"},innerRing:{position:"absolute",width:224,height:224,borderRadius:112,borderWidth:1,borderColor:"#0B627C"},emblem:{width:"100%",height:"100%",maxWidth:320,maxHeight:320},wordmark:{fontSize:30,letterSpacing:6,textAlign:"center",color:theme.text,fontWeight:"500",marginTop:2,textShadowColor:"#18DCFF",textShadowRadius:10},subtitle:{fontSize:9,letterSpacing:1.5,textAlign:"center",color:theme.textDim,marginTop:5,marginBottom:18},
 description:{fontSize:13,lineHeight:20,textAlign:"center",color:theme.textDim,paddingHorizontal:8,marginTop:12,marginBottom:6},
 tiles:{marginTop:"auto",paddingTop:24,flexDirection:"row",flexWrap:"nowrap",justifyContent:"space-between",gap:10},tile:{flex:1,minWidth:0,padding:8,alignItems:"center",justifyContent:"center"},tileLabel:{fontSize:11,color:theme.text,marginTop:7,textAlign:"center"},edge:{height:2,width:24,backgroundColor:theme.accent,position:"absolute",top:0,right:12},badge:{position:"absolute",top:5,right:6,backgroundColor:theme.accent,minWidth:18,height:18,borderRadius:9,alignItems:"center",justifyContent:"center",paddingHorizontal:3},badgeText:{fontSize:10,color:theme.onAccent,fontWeight:"700"},search:{flexDirection:"row",gap:12,alignItems:"center",borderWidth:1,borderColor:theme.accent,borderRadius:28,backgroundColor:"#00131be8",padding:14,marginTop:18},searchText:{fontSize:14,color:theme.textDim,flex:1},
});
