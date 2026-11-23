import React,{useState} from 'react';
import {Modal,View,ScrollView,TouchableOpacity,Switch,StyleSheet,ActivityIndicator} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {KeyboardAvoidingView} from 'react-native-keyboard-controller';
import {Ionicons} from '@expo/vector-icons';
import {Text,TextInput} from './HudText';
import {theme} from '../theme';
import {useI18n} from '../lib/i18n';
export default function DirectPollComposer({onClose,onCreate,busy,prepared,error}){
 const {lang}=useI18n(),say=(it,en)=>lang==='it'?it:en;
 const [question,setQuestion]=useState(''),[options,setOptions]=useState(['','']),[correct,setCorrect]=useState(null),[explanation,setExplanation]=useState(''),[limited,setLimited]=useState(false),[minutes,setMinutes]=useState('60');
 const [settings,setSettings]=useState({publicVotes:false,multiple:false,allowAdd:false,canChange:true,shuffle:false,quiz:false});
 const toggle=(key,value)=>setSettings(s=>({...s,[key]:value,...(key==='quiz'&&value?{multiple:false,allowAdd:false,canChange:false}:{})}));
 const update=(index,value)=>setOptions(rows=>rows.map((row,i)=>i===index?value:row));
 const locked=busy||prepared;
 const valid=question.trim()&&options.every(s=>s.trim())&&options.length>=2&&(!settings.quiz||correct!==null)&&(!limited||(/^\d+$/.test(minutes)&&Number(minutes)>=1&&Number(minutes)<=10080));
 const rows=[
 ['publicVotes','eye-outline',say('Mostra chi ha votato','Show voters'),say('Mostra i nomi nei risultati.','Display names in the results.')],
 ['multiple','list-outline',say('Consenti risposte multiple','Multiple answers'),say('Si può scegliere più di una risposta.','More than one answer can be selected.')],
 ['allowAdd','add-circle-outline',say('Consenti nuove opzioni','Allow new options'),say('Anche il contatto può aggiungere risposte, fino a 12.','Your contact can add answers, up to 12.')],
 ['canChange','sync-outline',say('Consenti di cambiare voto','Allow changing votes'),say('Permette anche di ritirare il voto.','Also allows withdrawing a vote.')],
 ['shuffle','shuffle-outline',say('Mescola le opzioni','Shuffle options'),say('Ordine diverso e stabile per ogni partecipante.','A different, stable order for each participant.')],
 ['quiz','checkmark-circle-outline',say('Modalità Quiz','Quiz mode'),say('Una risposta corretta; il voto è definitivo.','One correct answer; voting is final.')],
 ];
 return <Modal visible animationType="slide" onRequestClose={()=>{if(!busy)onClose();}}>
  <SafeAreaView style={s.root}><KeyboardAvoidingView behavior="padding" style={{flex:1}}>
   <View style={s.header}><TouchableOpacity disabled={busy} onPress={onClose} accessibilityLabel={say('Annulla','Cancel')}><Ionicons name="arrow-back" size={25} color={theme.text}/></TouchableOpacity><Text style={s.title}>{say('Nuovo sondaggio','New poll')}</Text><TouchableOpacity testID="direct-poll-create" disabled={!valid||busy} style={[s.create,(!valid||busy)&&{opacity:.4}]} onPress={()=>onCreate({question,options,settings,correct,explanation,minutes:limited?Number(minutes):null})}>{busy?<ActivityIndicator color={theme.onAccent}/>:<Text style={s.createText}>{say('Crea','Create')}</Text>}</TouchableOpacity></View>
   <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="always">
    {!!error&&<Text accessibilityRole="alert" style={{color:theme.danger}}>{error}</Text>}
    <Text style={s.section}>{say('DOMANDA','QUESTION')}</Text><View style={s.panel}><TextInput testID="direct-poll-question" editable={!locked} value={question} onChangeText={setQuestion} maxLength={1000} multiline placeholder={say('Scrivi una domanda…','Write a question…')} placeholderTextColor={theme.textDim} style={s.input}/></View>
    <Text style={s.section}>{say('RISPOSTE','ANSWERS')} · {options.length}/12</Text><View style={s.panel}>
     {options.map((option,index)=><View key={index} style={s.option}>
      {settings.quiz?<TouchableOpacity testID={'direct-poll-correct-'+index} disabled={locked} onPress={()=>setCorrect(index)} accessibilityLabel={say('Risposta corretta','Correct answer')}><Ionicons name={correct===index?'checkmark-circle':'ellipse-outline'} size={24} color={correct===index?'#37d69a':theme.textDim}/></TouchableOpacity>:<Text style={s.number}>{index+1}</Text>}
      <TextInput testID={"direct-poll-option-"+index} editable={!locked} value={option} onChangeText={value=>update(index,value)} maxLength={180} placeholder={say('Opzione','Option')} placeholderTextColor={theme.textDim} style={[s.input,{flex:1}]}/>
      {index>0&&<TouchableOpacity disabled={locked} onPress={()=>{setOptions(values=>{const next=[...values];[next[index-1],next[index]]=[next[index],next[index-1]];return next;});if(correct===index)setCorrect(index-1);else if(correct===index-1)setCorrect(index);}} accessibilityLabel={say('Sposta su','Move up')}><Ionicons name="chevron-up" color={theme.textDim} size={21}/></TouchableOpacity>}
      {options.length>2&&<TouchableOpacity disabled={locked} onPress={()=>{setOptions(values=>values.filter((_,i)=>i!==index));setCorrect(value=>value===index?null:value>index?value-1:value);}} accessibilityLabel={say('Rimuovi opzione','Remove option')}><Ionicons name="close" size={21} color={theme.textDim}/></TouchableOpacity>}
     </View>)}
     {options.length<12&&<TouchableOpacity style={s.add} disabled={locked} onPress={()=>setOptions(values=>[...values,''])}><Ionicons name="add-circle" size={23} color={theme.accent}/><Text style={s.accent}>{say('Aggiungi un’opzione','Add an option')}</Text></TouchableOpacity>}
    </View>
    <Text style={s.section}>{say('IMPOSTAZIONI','SETTINGS')}</Text><View style={s.panel}>{rows.map(([key,icon,label,hint])=><View key={key} style={s.setting}><Ionicons name={icon} size={24} color={theme.accent}/><View style={{flex:1}}><Text style={s.label}>{label}</Text><Text style={s.hint}>{hint}</Text></View><Switch testID={'direct-poll-setting-'+key} disabled={locked||(settings.quiz&&['multiple','allowAdd','canChange'].includes(key))} value={settings[key]} onValueChange={value=>toggle(key,value)} trackColor={{false:theme.border,true:'#126f91'}} thumbColor={settings[key]?theme.accent:'#7d919d'}/></View>)}
     <View style={s.setting}><Ionicons name="timer-outline" size={24} color={theme.accent}/><View style={{flex:1}}><Text style={s.label}>{say('Limita la durata','Limit duration')}</Text><Text style={s.hint}>{say('Chiusura automatica; puoi chiuderlo prima.','Closes automatically; you can close it earlier.')}</Text></View><Switch disabled={locked} value={limited} onValueChange={setLimited} trackColor={{false:theme.border,true:'#126f91'}} thumbColor={limited?theme.accent:'#7d919d'}/></View>
     {limited&&<View style={s.option}><Text style={s.label}>{say('Minuti','Minutes')}</Text><TextInput editable={!locked} keyboardType="number-pad" value={minutes} onChangeText={setMinutes} maxLength={5} style={[s.input,{flex:1}]} /><Text style={s.hint}>1–10080</Text></View>}
    </View>
    {settings.quiz&&<><Text style={s.section}>{say('SPIEGAZIONE · FACOLTATIVA','EXPLANATION · OPTIONAL')}</Text><View style={s.panel}><TextInput editable={!locked} multiline maxLength={2000} value={explanation} onChangeText={setExplanation} placeholder={say('Perché è la risposta corretta?','Why is this correct?')} placeholderTextColor={theme.textDim} style={s.input}/></View><Text style={s.hint}>{say('La soluzione viene inviata dopo il voto, quando il creatore è online.','The solution is sent after voting, when the creator is online.')}</Text></>}
    <Text style={s.hint}>{say('Domanda, opzioni e voti viaggiano nella chat cifrata end-to-end. Nascondere i nomi non rende anonimo un voto in una chat fra due persone.','Question, options and votes travel through the end-to-end encrypted chat. Hiding names does not make a vote anonymous in a conversation between two people.')}</Text>
   </ScrollView>
  </KeyboardAvoidingView></SafeAreaView>
 </Modal>;
}
const s=StyleSheet.create({root:{flex:1,backgroundColor:theme.background||'#06121d'},header:{flexDirection:'row',alignItems:'center',gap:14,padding:16,borderBottomWidth:1,borderBottomColor:theme.border},title:{flex:1,color:theme.text,fontSize:19,fontWeight:'800'},create:{paddingHorizontal:20,paddingVertical:10,borderRadius:22,backgroundColor:theme.accent},createText:{color:theme.onAccent,fontWeight:'800'},content:{padding:18,gap:12,paddingBottom:36},section:{color:theme.accent,fontSize:12,fontWeight:'800',letterSpacing:1,marginTop:8},panel:{borderRadius:20,padding:12,backgroundColor:theme.surfaceAlt,borderWidth:1,borderColor:theme.border},input:{color:theme.text,fontSize:16,minHeight:45,padding:8},option:{flexDirection:'row',gap:10,alignItems:'center',borderBottomWidth:1,borderBottomColor:theme.border,minHeight:54},number:{color:theme.textDim,width:22,textAlign:'center'},setting:{flexDirection:'row',alignItems:'center',gap:12,paddingVertical:12},label:{color:theme.text,fontSize:15,fontWeight:'600'},hint:{color:theme.textDim,fontSize:12,lineHeight:18,marginTop:3},add:{flexDirection:'row',gap:12,alignItems:'center',paddingVertical:15},accent:{color:theme.accent,fontSize:15}});
