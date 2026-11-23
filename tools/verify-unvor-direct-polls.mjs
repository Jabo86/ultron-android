import assert from 'node:assert/strict';
import {makeDirectPoll,pollPacket,pollBody,readPollPacket,reduceDirectPolls,orderedPollOptions,quizCommitment} from '../src/lib/directPolls.js';
const config={question:'Question?',options:['A','B','C'],settings:{publicVotes:false,multiple:true,allowAdd:true,canChange:true,shuffle:true,quiz:false}};
const {packet}=makeDirectPoll(config);const rows=[];let n=0;
function add(p,mine=false,at=Date.now()){rows.push({message:(++n).toString(16).padStart(24,'0'),mine,at,packet:p});return reduceDirectPolls(rows).get(packet.id);}
let poll=add(packet,true);assert.equal(poll.creator,'me');assert.deepEqual(readPollPacket(pollBody(packet)),packet);
poll=add(pollPacket(packet.id,'vote',{choices:[packet.options[0].id,packet.options[1].id]}));assert.equal(poll.votes.peer.length,2);
poll=add(pollPacket(packet.id,'vote',{choices:[packet.options[2].id]}));assert.deepEqual(poll.votes.peer,[packet.options[2].id]);
poll=add(pollPacket(packet.id,'option',{option:{id:'ab'.repeat(8),text:'D'}}));assert.equal(poll.options.length,4);
assert.deepEqual(orderedPollOptions(poll),orderedPollOptions(poll));
poll=add(pollPacket(packet.id,'close'));assert.equal(poll.closed,false,'peer cannot close creator poll');
poll=add(pollPacket(packet.id,'vote',{choices:['ff'.repeat(8)]}));assert.deepEqual(poll.votes.peer,[packet.options[2].id]);
poll=add(pollPacket(packet.id,'close'),true);assert.equal(poll.closed,true);poll=add(pollPacket(packet.id,'vote',{choices:[]}));assert.equal(poll.votes.peer.length,1,'closed poll rejects changes');
const quiz=makeDirectPoll({...config,settings:{...config.settings,quiz:true},correct:1,explanation:'Explanation'});
assert.equal('correct' in quiz.packet,false);assert.equal('salt' in quiz.packet,false);assert.equal('explanation' in quiz.packet,false);
assert.equal(quiz.packet.settings.multiple,false);assert.equal(quiz.packet.settings.canChange,false);assert.equal(quiz.packet.settings.allowAdd,false);
const qrows=[{message:'01',mine:true,at:1,packet:quiz.packet},{message:'02',mine:false,at:2,packet:pollPacket(quiz.packet.id,'vote',{choices:[quiz.packet.options[0].id]})},{message:'03',mine:false,at:3,packet:pollPacket(quiz.packet.id,'vote',{choices:[quiz.packet.options[1].id]})}];
let qp=reduceDirectPolls(qrows).get(quiz.packet.id);assert.deepEqual(qp.votes.peer,[quiz.packet.options[0].id],'quiz vote cannot change');
qrows.push({message:'04',mine:false,at:4,packet:pollPacket(quiz.packet.id,'reveal',quiz.secret)});assert.equal(reduceDirectPolls(qrows).get(quiz.packet.id).reveal,null,'peer cannot reveal');
qrows.push({message:'05',mine:true,at:5,packet:pollPacket(quiz.packet.id,'reveal',{...quiz.secret,correct:quiz.packet.options[0].id})});assert.equal(reduceDirectPolls(qrows).get(quiz.packet.id).reveal,null,'commitment rejects changed solution');
qrows.push({message:'06',mine:true,at:6,packet:pollPacket(quiz.packet.id,'reveal',quiz.secret)});qp=reduceDirectPolls(qrows).get(quiz.packet.id);assert.equal(qp.reveal.correct,quiz.packet.options[1].id);
const timed={...packet,id:'cd'.repeat(16),closesAt:10};const deadlineRows=[{message:'01',mine:true,at:1,packet:timed},{message:'02',mine:false,at:11,packet:pollPacket(timed.id,'vote',{choices:[packet.options[0].id]})}];assert.deepEqual(reduceDirectPolls(deadlineRows).get(timed.id).votes,{});
assert.throws(()=>makeDirectPoll({...config,minutes:0}));assert.throws(()=>makeDirectPoll({...config,options:Array(13).fill('x')}));
console.log('Direct E2EE polls: multiple/change/final votes, added options, stable shuffle, author-only close, deadlines, committed quiz solutions, no early answer disclosure and tamper rejection verified.');

// Poll state survives a new history page, stays scoped to the account, and is wiped with the chat.
const {readFileSync}=await import('node:fs'),{runInNewContext}=await import('node:vm');
const {sha256Hex}=await import('../src/lib/crypto.js');
const disk=new Map(),owner={server:'synthetic',lns:'owner'},other={server:'synthetic',lns:'decoy'};let active=owner;
const storeSource=readFileSync(new URL('../src/lib/directPollStore.js',import.meta.url),'utf8').replace(/^import .*;$/gm,'').replace(/^export /gm,'');
const store=runInNewContext(storeSource+'\n({saveDirectPollSecret,syncDirectPolls,clearDirectPolls,forgetDirectPoll,quizReveals})',{
 api:{authenticatedScope:user=>()=>{if(user!==active)throw new Error('scope changed');}},getBlob:async name=>structuredClone(disk.get(name)),setBlobsDurably:async entries=>{for(const[k,v]of entries)disk.set(k,structuredClone(v));},removeBlob:async name=>disk.delete(name),sha256Hex,readPollPacket,reduceDirectPolls,pollPacket,
});
await store.saveDirectPollSecret(owner,'peer',quiz.packet,quiz.secret);
let state=await store.syncDirectPolls(owner,'peer',qrows.slice(0,2).map(row=>({id:row.message,mine:row.mine,at:new Date(row.at).toISOString(),body:pollBody(row.packet)})));
assert.equal(state.polls.size,1);assert.equal(store.quizReveals(state).length,1);const op=store.quizReveals(state)[0].op;assert.equal(store.quizReveals(state)[0].op,op,'solution retry is idempotent');
state=await store.syncDirectPolls(owner,'peer',[]);assert.equal(state.polls.size,1,'history page change preserves the poll');
active=other;assert.equal((await store.syncDirectPolls(other,'peer',[])).polls.size,0,'decoy account is isolated');await assert.rejects(store.clearDirectPolls(owner,'peer'),/scope changed/);
active=owner;await store.syncDirectPolls(owner,'peer',[],['01']);state=await store.syncDirectPolls(owner,'peer',[]);assert.equal(state.polls.size,0);assert.equal(Object.keys(state.secrets).length,0,'deleting a quiz removes its private solution');
await store.clearDirectPolls(owner,'peer');assert.equal(disk.size,0);
console.log('Direct poll storage: history pagination, account isolation, stable reveal retries, message deletion and complete chat cleanup verified.');
