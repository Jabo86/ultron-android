import React,{useEffect,useState,useRef} from 'react';
import {View,TouchableOpacity,StyleSheet,ActivityIndicator} from 'react-native';
import {Ionicons} from '@expo/vector-icons';
import {Text,TextInput} from './HudText';
import {theme} from '../theme';
import {useI18n} from '../lib/i18n';
import {orderedPollOptions,pollPacket} from '../lib/directPolls';
import {randomHex} from '../lib/crypto';
export default function DirectPollCard({poll,onPacket,peerName,onProfile}){
 const actionBusy=useRef(false);
 const {lang}=useI18n(),say=(it,en)=>lang==='it'?it:en;
 const [selection,setSelection]=useState(poll.votes.me||[]),[busy,setBusy]=useState(false),[newOption,setNewOption]=useState(''),[adding,setAdding]=useState(false),[explain,setExplain]=useState(false),[now,setNow]=useState(Date.now());
 useEffect(()=>{setSelection(poll.votes.me||[]);},[JSON.stringify(poll.votes.me)]);
 const closed=poll.closed||(poll.closesAt!=null&&now>=poll.closesAt),voted=!!poll.votes.me?.length,own=poll.creator==='me';
 const locked=closed||busy||(poll.settings.quiz&&own)||(voted&&!poll.settings.canChange);
 useEffect(()=>{if(!poll.closesAt||closed)return;const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[poll.closesAt,closed]);
 const total=Object.values(poll.votes).filter(v=>v.length).length,results=!poll.settings.quiz||voted||own;
 const action=async(kind,fields)=>{if(actionBusy.current)return;actionBusy.current=true;setBusy(true);try{await onPacket(pollPacket(poll.id,kind,fields));if(kind==='option'){setAdding(false);setNewOption('');}}catch{/* The conversation displays the error. */}finally{actionBusy.current=false;setBusy(false);}};
 const options=orderedPollOptions(poll);
 return <View style={s.root} testID="direct-poll-card">
  <View style={s.heading}><Ionicons name={poll.settings.quiz?'school-outline':'stats-chart-outline'} color={theme.accent} size={21}/><Text style={s.type}>{poll.settings.quiz?'QUIZ':say('SONDAGGIO','POLL')}{closed?' · '+say('CHIUSO','CLOSED'):''}</Text>{busy&&<ActivityIndicator size="small" color={theme.accent}/>}</View>
  <TouchableOpacity onPress={onProfile} disabled={own}><Text style={s.creator}>{own?say('Creato da te','Created by you'):peerName}</Text></TouchableOpacity>
  <Text style={s.question}>{poll.question}</Text>
  <Text style={s.hint}>{poll.settings.multiple?say('Puoi scegliere più risposte','You can select multiple answers'):say('Una sola risposta','One answer')}{poll.settings.publicVotes?' · '+say('Voti visibili','Visible votes'):''}</Text>
  {options.map(option=>{const chosen=selection.includes(option.id),count=Object.values(poll.votes).filter(v=>v.includes(option.id)).length,correct=poll.reveal?.correct===option.id,wrong=poll.settings.quiz&&voted&&poll.votes.me.includes(option.id)&&poll.reveal&&!correct;
   const color=correct?'#38d69a':wrong?'#ff7186':theme.accent;
   return <TouchableOpacity key={option.id} style={[s.option,(chosen||correct||wrong)&&{borderColor:color}]} disabled={locked} onPress={()=>setSelection(values=>poll.settings.multiple?(values.includes(option.id)?values.filter(v=>v!==option.id):[...values,option.id]):[option.id])}>
    {results&&<View style={[s.bar,{width:total?`${count/total*100}%`:'0%',backgroundColor:color}]}/>}
    <Ionicons name={correct?'checkmark-circle':wrong?'close-circle':chosen?'radio-button-on':'radio-button-off'} size={22} color={chosen||correct||wrong?color:theme.textDim}/><View style={{flex:1}}><Text style={s.optionText}>{option.text}</Text>{results&&poll.settings.publicVotes&&count>0&&<Text style={s.hint}>{Object.entries(poll.votes).filter(([,v])=>v.includes(option.id)).map(([actor])=>actor==='me'?say('Tu','You'):peerName).join(', ')}</Text>}</View>{results&&<Text style={s.percent}>{total?Math.round(count/total*100):0}%</Text>}
   </TouchableOpacity>;
  })}
  {!locked&&<TouchableOpacity testID="direct-poll-vote" disabled={!selection.length||busy} style={[s.button,!selection.length&&{opacity:.4}]} onPress={()=>action('vote',{choices:selection})}><Text style={s.buttonText}>{voted?say('Aggiorna voto','Update vote'):say('Vota','Vote')}</Text></TouchableOpacity>}
  {voted&&!closed&&poll.settings.canChange&&<TouchableOpacity disabled={busy} onPress={()=>action('vote',{choices:[]})}><Text style={s.link}>{say('Ritira voto','Withdraw vote')}</Text></TouchableOpacity>}
  {poll.settings.quiz&&voted&&!poll.reveal&&<Text style={s.hint}>{say('Risposta inviata. La soluzione arriverà quando il creatore riceve il voto.','Answer sent. The solution arrives when the creator receives your vote.')}</Text>}
  {poll.reveal&&<View style={s.explanation}><TouchableOpacity style={s.heading} onPress={()=>setExplain(v=>!v)}><Ionicons name="bulb-outline" size={22} color="#ffcf66"/><Text style={s.optionText}>{say('Risposta e spiegazione','Answer and explanation')}</Text><Ionicons name={explain?'chevron-up':'chevron-down'} color={theme.textDim} size={18}/></TouchableOpacity>{explain&&<Text style={s.explanationText}>{poll.options.find(o=>o.id===poll.reveal.correct)?.text}{poll.reveal.explanation?'\n\n'+poll.reveal.explanation:''}</Text>}</View>}
  {poll.settings.allowAdd&&!closed&&poll.options.length<12&&<View>{adding?<View style={s.addRow}><TextInput value={newOption} maxLength={180} onChangeText={setNewOption} placeholder={say('Nuova opzione','New option')} placeholderTextColor={theme.textDim} style={s.newOption}/><TouchableOpacity disabled={!newOption.trim()||busy} onPress={()=>action('option',{option:{id:randomHex(8),text:newOption.trim()}})}><Ionicons name="checkmark-circle" size={28} color={theme.accent}/></TouchableOpacity><TouchableOpacity onPress={()=>setAdding(false)}><Ionicons name="close" color={theme.textDim} size={22}/></TouchableOpacity></View>:<TouchableOpacity onPress={()=>setAdding(true)}><Text style={s.link}>+ {say('Aggiungi opzione','Add option')}</Text></TouchableOpacity>}</View>}
  <View style={s.footer}><Text style={s.hint}>{total} {say('partecipanti hanno votato','participants voted')}</Text>{own&&!closed&&<TouchableOpacity disabled={busy} onPress={()=>action('close',{})}><Text style={s.link}>{say('Chiudi','Close')}</Text></TouchableOpacity>}</View>
  {poll.closesAt&&!closed&&<Text style={s.hint}>{say('Termina fra','Ends in')} {Math.max(0,Math.ceil((poll.closesAt-now)/60000))} min</Text>}
 </View>;
}
const s=StyleSheet.create({root:{minWidth:240,maxWidth:330,gap:10},heading:{flexDirection:'row',gap:8,alignItems:'center'},type:{color:theme.accent,fontSize:11,fontWeight:'800',letterSpacing:1,flex:1},creator:{color:theme.accent,fontSize:12},question:{fontSize:17,lineHeight:24,fontWeight:'700',color:theme.text},hint:{fontSize:11,color:theme.textDim,lineHeight:16},option:{minHeight:48,flexDirection:'row',gap:10,alignItems:'center',borderWidth:1,borderColor:theme.border,borderRadius:13,padding:11,overflow:'hidden'},bar:{position:'absolute',top:0,left:0,bottom:0,opacity:.12},optionText:{color:theme.text,fontSize:14,flexShrink:1},percent:{color:theme.textDim,fontSize:12,fontWeight:'700'},button:{backgroundColor:theme.accent,borderRadius:12,padding:12,alignItems:'center'},buttonText:{color:theme.onAccent,fontWeight:'800'},link:{color:theme.accent,fontSize:12,fontWeight:'700',paddingVertical:6},footer:{flexDirection:'row',alignItems:'center',justifyContent:'space-between'},explanation:{borderWidth:1,borderColor:theme.border,borderRadius:13,padding:10,gap:10},explanationText:{color:theme.text,lineHeight:20,fontSize:13},addRow:{flexDirection:'row',gap:8,alignItems:'center'},newOption:{flex:1,color:theme.text,borderBottomWidth:1,borderBottomColor:theme.border,minHeight:44}});
