import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";
import { createExclusiveDocumentPicker } from "../src/lib/documentPickerGuard.js";
import { withSystemActivity, isLockSuppressed, clearLockSuppress } from "../src/lib/lockGuard.js";
const require = createRequire(import.meta.url);
const { parse } = require("@babel/parser");
const generate = require("@babel/generator").default;
const { patchDocumentPicker } = require("./patch-ultron-document-picker.cjs");
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return { promise, resolve, reject }; };
let nativeCall = deferred(), opens = 0;
const options = { type: "application/pdf", copyToCacheDirectory: true };
const pick = createExclusiveDocumentPicker(async args => { opens++; assert.equal(args, options); return nativeCall.promise; }, withSystemActivity);
clearLockSuppress();
const first = pick(options);
assert.equal(isLockSuppressed(), true);
for (let i=0; i<10; i++) assert.deepEqual(await pick(options), { canceled:true, assets:null });
assert.equal(opens,1,"duplicate taps must not queue or open another native picker");
const selected = { canceled:false, assets:[{uri:"file:///synthetic.pdf"}] };
nativeCall.resolve(selected); assert.equal(await first,selected);
assert.equal(isLockSuppressed(),true,"preserve foreground transition grace");
clearLockSuppress(); assert.equal(isLockSuppressed(),false);
nativeCall=deferred();const cancel=pick(options);nativeCall.resolve({canceled:true,assets:null});assert.equal((await cancel).canceled,true);
nativeCall=deferred();const failed=pick(options);nativeCall.reject(new Error("synthetic launch failure"));await assert.rejects(failed,/launch failure/);
clearLockSuppress();assert.equal(isLockSuppressed(),false);
nativeCall=deferred();const retry=pick(options);nativeCall.resolve(selected);assert.equal(await retry,selected);
const broken = createExclusiveDocumentPicker(() => { throw new Error("sync failure"); }, withSystemActivity);
await assert.rejects(broken(options),/sync failure/);await assert.rejects(broken(options),/sync failure/);

// The actual picker stages several files and never performs network/upload/send work.
const chat=fs.readFileSync(new URL("../src/screens/ChatScreen.js",import.meta.url),"utf8");
const ast=parse(chat,{sourceType:"module",plugins:["jsx"]});
const handlers={};
function walk(node){if(!node||typeof node!=="object")return;if(node.type==="VariableDeclarator"&&['attachFile','sendDocumentsDraft'].includes(node.id.name))handlers[node.id.name]=node.init;for(const value of Object.values(node)){if(Array.isArray(value))value.forEach(walk);else if(value&&typeof value==='object')walk(value);}}
walk(ast);
let picks=0,uploads=0,sends=0,checks=0,selectedDraftFiles=[],pickerOptions;
const context={deletingChat:{current:false},documentFlow:{current:false},sending:false,documentDraft:{current:[]},documentUploads:{current:new Set()},documentPrepared:{current:null},sha256Hex:JSON.stringify,mounted:{current:true},others:['peer'],user:{kem:{}},lang:'it',text:'caption',replyTo:null,ttl:0,convId:'thread',
 DocumentPicker:{getDocumentAsync:async opts=>{pickerOptions=opts;picks++;return{canceled:false,assets:[{uri:'file:///a',name:'a.pdf',size:4},{uri:'file:///b',name:'b.pdf',size:8}]};}},
 bigatt:{MAX_ATT:50*1024*1024,ATT_CHUNK:4096},discardDocuments:async()=>{},setDraftDocuments:rows=>{selectedDraftFiles=rows;},setErr:()=>{},api:{authenticatedScope:()=>()=>{},apiErr:e=>e.message,blobUpload:async()=>{uploads++;return{id:'file'+uploads};}},
 FileSystem:{EncodingType:{Base64:'base64'},readAsStringAsync:async()=>''},base64ToBytes:()=>new Uint8Array(4),encryptFileBytesAsync:async()=>({ciphertext:new Uint8Array(20),key:'key',iv:'iv'}),
 maySendToContact:async()=>{checks++;return true;},packMessage:(text,atts)=>({text,atts}),sendChatMessage:async payload=>{sends++;assert.equal(payload.atts.length,2);return{};},
 setSending:()=>{},setUploadPct:()=>{},setText:()=>{},setReplyTo:()=>{},setConvId:()=>{},load:async()=>{}};
const attach=vm.runInNewContext(`(${generate(handlers.attachFile).code})`,context);
await attach();assert.equal(pickerOptions.multiple,true);assert.equal(selectedDraftFiles.length,2);assert.equal(uploads,0);assert.equal(sends,0);assert.equal(checks,0,'selection must not wait for network');
const chosenDraft=[...selectedDraftFiles];
const confirm=vm.runInNewContext(`(${generate(handlers.sendDocumentsDraft).code})`,context);
await confirm();assert.equal(uploads,2);assert.equal(sends,1);assert.equal(context.documentDraft.current.length,0);
context.documentDraft.current=chosenDraft;context.maySendToContact=async()=>false;await confirm();assert.equal(sends,1,'denied contact must not send files');

context.maySendToContact=async()=>true;let lose=true;
context.sendChatMessage=async()=>{sends++;if(lose){lose=false;throw new Error('response lost');}return{};};
await confirm();const uploadedBeforeRetry=uploads;assert.equal(context.documentDraft.current.length,2);
await confirm();assert.equal(uploads,uploadedBeforeRetry,'retry reuses already uploaded attachments');assert.equal(context.documentDraft.current.length,0);

const root = new URL("../node_modules/expo-document-picker/android/src/main/java/expo/modules/documentpicker/DocumentPickerModule.kt",import.meta.url);
const patched=fs.readFileSync(root,"utf8");assert.equal(patchDocumentPicker(patched),patched,"native patch is idempotent");
assert.match(patched,/catch \(error: Exception\) \{\s+pendingPromise = null\s+throw error/);
assert.throws(()=>patchDocumentPicker("changed upstream source"),/Unexpected/);
for(const name of fs.readdirSync(new URL("../src/screens",import.meta.url))){
 if(name.endsWith('.js'))assert.ok(!fs.readFileSync(new URL('../src/screens/'+name,import.meta.url),'utf8').includes('from "expo-document-picker"'),name+' bypasses the app-wide gate');
}
clearLockSuppress();
console.log("Document picker: repeated taps, one native launch/result, cancellation, errors, retry, PIN transition guard, chat upload lifetime and native launch cleanup verified.");
