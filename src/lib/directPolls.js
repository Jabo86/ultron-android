import { randomHex, sha256Hex } from './crypto.js';
export const POLL_PREFIX='\u0002UNVOR-POLL1\n';
const id=value=>typeof value==='string'&&/^[a-f0-9]{16,32}$/.test(value);
const text=(value,max)=>typeof value==='string'&&value.trim().length>0&&value.length<=max;
export function readPollPacket(body){
 if(typeof body!=='string'||!body.startsWith(POLL_PREFIX)||body.length>18000)return null;
 try{const packet=JSON.parse(body.slice(POLL_PREFIX.length));return packet.v===1&&id(packet.id)&&id(packet.op)&&['create','vote','option','close','reveal'].includes(packet.kind)?packet:null;}catch{return null;}
}
export function pollBody(packet){return POLL_PREFIX+JSON.stringify(packet);}
export function pollPacket(pollId,kind,fields={}){return{v:1,id:pollId,op:randomHex(16),kind,...fields};}
export function quizCommitment(pollId,option,salt,explanation){return sha256Hex(JSON.stringify(['unvor-direct-quiz-v1',pollId,option,salt,explanation]));}
export function makeDirectPoll({question,options,settings,minutes,explanation,correct}){
 if(!text(question,1000)||options.length<2||options.length>12||options.some(value=>!text(value,180)))throw new Error('Inserisci una domanda e da 2 a 12 risposte.');
 const pollId=randomHex(16),rows=options.map(value=>({id:randomHex(8),text:value.trim()}));
 const quiz=!!settings.quiz;
 if(quiz&&(!Number.isInteger(correct)||correct<0||correct>=rows.length))throw new Error('Seleziona la risposta corretta.');
 if(minutes!=null&&(!Number.isInteger(minutes)||minutes<1||minutes>10080))throw new Error('Durata: da 1 minuto a 7 giorni.');
 const secret=quiz?{correct:rows[correct].id,salt:randomHex(16),explanation:String(explanation||'').slice(0,2000)}:null;
 const packet=pollPacket(pollId,'create',{question:question.trim(),options:rows,settings:{publicVotes:!!settings.publicVotes,multiple:!quiz&&!!settings.multiple,allowAdd:!quiz&&!!settings.allowAdd,canChange:!quiz&&!!settings.canChange,shuffle:!!settings.shuffle,quiz},closesAt:minutes==null?null:Date.now()+minutes*60000,...(secret?{commitment:quizCommitment(pollId,secret.correct,secret.salt,secret.explanation)}:{})});
 return{packet,secret};
}
function validCreate(packet){
 const s=packet.settings;
 return text(packet.question,1000)&&Array.isArray(packet.options)&&packet.options.length>=2&&packet.options.length<=12&&packet.options.every(o=>id(o.id)&&text(o.text,180))&&new Set(packet.options.map(o=>o.id)).size===packet.options.length&&s&&['publicVotes','multiple','allowAdd','canChange','shuffle','quiz'].every(k=>typeof s[k]==='boolean')&&(!s.quiz||(!s.multiple&&!s.allowAdd&&!s.canChange&&/^[a-f0-9]{64}$/.test(packet.commitment)))&&(packet.closesAt===null||Number.isSafeInteger(packet.closesAt));
}
export function reduceDirectPolls(events){
 const polls=new Map(),seen=new Set();
 for(const row of [...events].sort((a,b)=>String(a.message).localeCompare(String(b.message)))){
  const p=row.packet,actor=row.mine?'me':'peer';if(!p||seen.has(p.op))continue;seen.add(p.op);
  if(p.kind==='create'){
   if(!polls.has(p.id)&&validCreate(p))polls.set(p.id,{...p,creator:actor,message:row.message,options:[...p.options],votes:{},closed:false,reveal:null});
   continue;
  }
  const poll=polls.get(p.id);if(!poll)continue;
  const afterDeadline=poll.closesAt!=null&&row.at>poll.closesAt;
  if(p.kind==='reveal'){
   if(actor===poll.creator&&poll.settings.quiz&&id(p.correct)&&/^[a-f0-9]{32}$/.test(p.salt||'')&&typeof p.explanation==='string'&&p.explanation.length<=2000&&poll.options.some(o=>o.id===p.correct)&&quizCommitment(p.id,p.correct,p.salt,p.explanation)===poll.commitment)poll.reveal={correct:p.correct,explanation:p.explanation};
  }else if(p.kind==='close'){if(actor===poll.creator)poll.closed=true;
  }else if(!poll.closed&&!afterDeadline&&p.kind==='option'){
   if(poll.settings.allowAdd&&poll.options.length<12&&id(p.option?.id)&&text(p.option.text,180)&&!poll.options.some(o=>o.id===p.option.id))poll.options.push(p.option);
  }else if(!poll.closed&&!afterDeadline&&p.kind==='vote'){
   if(!Array.isArray(p.choices)||p.choices.some(choice=>!poll.options.some(o=>o.id===choice))||new Set(p.choices).size!==p.choices.length||(!poll.settings.multiple&&p.choices.length>1))continue;
   if(poll.settings.quiz&&(actor===poll.creator||p.choices.length!==1))continue;
   if(poll.votes[actor]&&!poll.settings.canChange)continue;
   if(!p.choices.length&&!poll.settings.canChange)continue;
   poll.votes[actor]=p.choices;
  }
 }
 return polls;
}
export function orderedPollOptions(poll,actor='me'){
 return poll.settings.shuffle?[...poll.options].sort((a,b)=>sha256Hex(poll.id+actor+a.id).localeCompare(sha256Hex(poll.id+actor+b.id))):poll.options;
}
