import * as api from "./api";
import { getBlob,setBlobsDurably,removeBlob } from './lock';
import {sha256Hex} from './crypto';
import {readPollPacket,reduceDirectPolls,pollPacket} from './directPolls';
const queues=new Map();
const key=(user,peer)=>'direct-polls:'+sha256Hex(JSON.stringify([user.server,user.lns,peer]));
function serial(name,job){const task=(queues.get(name)||Promise.resolve()).catch(()=>{}).then(job);queues.set(name,task);return task.finally(()=>{if(queues.get(name)===task)queues.delete(name);});}
export function saveDirectPollSecret(user,peer,packet,secret){const name=key(user,peer),check=api.authenticatedScope(user);return serial(name,async()=>{check();const state=await getBlob(name)||{events:[],secrets:{}};check();await setBlobsDurably([[name,{...state,secrets:{...state.secrets,[packet.id]:secret}}]]);});}
export function syncDirectPolls(user,peer,rows,deleted=[]){const name=key(user,peer),check=api.authenticatedScope(user);return serial(name,async()=>{check();
 const state=await getBlob(name)||{events:[],secrets:{}};check();const removed=new Set(deleted);
 const removedPolls=new Set(state.events.filter(e=>removed.has(e.message)&&e.packet.kind==='create').map(e=>e.packet.id));
 const events=state.events.filter(e=>!removed.has(e.message)&&!removedPolls.has(e.packet.id));const ids=new Set(events.map(e=>e.message));let changed=events.length!==state.events.length;
 for(const row of rows){const packet=readPollPacket(row.body);if(packet&&!ids.has(row.id)&&!String(row.id).startsWith('tmp-')){events.push({message:row.id,mine:row.mine,at:Date.parse(row.at)||0,packet});ids.add(row.id);changed=true;}}
 const secrets={...state.secrets};for(const id of removedPolls)delete secrets[id];
 if(events.length>3000)throw new Error('Archivio dei sondaggi pieno: elimina i sondaggi precedenti.');
 if(changed)await setBlobsDurably([[name,{events,secrets}]]);
 return{polls:reduceDirectPolls(events),secrets};
});}
export function clearDirectPolls(user,peer){const name=key(user,peer),check=api.authenticatedScope(user);return serial(name,()=>{check();return removeBlob(name);});}
export function forgetDirectPoll(user,peer,pollId){const name=key(user,peer),check=api.authenticatedScope(user);return serial(name,async()=>{check();const state=await getBlob(name);check();if(!state)return;const secrets={...state.secrets};delete secrets[pollId];await setBlobsDurably([[name,{events:state.events.filter(e=>e.packet.id!==pollId),secrets}]]);});}
export function quizReveals(state){return [...state.polls.values()].filter(p=>p.creator==='me'&&p.settings.quiz&&!p.reveal&&p.votes.peer?.length&&state.secrets[p.id]).map(p=>({...pollPacket(p.id,'reveal',state.secrets[p.id]),op:sha256Hex('unvor-quiz-reveal:'+p.id+':'+p.commitment).slice(0,32)}));}
