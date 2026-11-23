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

// Exercise the actual chat handler, including the asynchronous consent check
// after opening the picker and processing that continues after the picker closes.
const chat = fs.readFileSync(new URL("../src/screens/ChatScreen.js",import.meta.url),"utf8");
const ast = parse(chat,{sourceType:"module",plugins:["jsx"]});
let handler;
function walk(node){ if(!node||typeof node!=="object")return; if(node.type==="VariableDeclarator"&&node.id.name==="attachFile")handler=node.init; for(const value of Object.values(node)){ if(Array.isArray(value))value.forEach(walk); else if(value&&typeof value==="object")walk(value); } }
walk(ast);assert.ok(handler);
const consent=deferred(), sent=deferred();let checks=0,picks=0,sends=0;
const context={deletingChat:{current:false},documentFlow:{current:false},others:["synthetic@ultron.uns"],user:{kem:{}},
 maySendToContact:()=>{checks++;return consent.promise;},suppressLock:()=>{},DocumentPicker:{getDocumentAsync:async()=>{picks++;return {canceled:false,assets:[{uri:"file:///synthetic.pdf",size:4}]};}},
 FileSystem:{readAsStringAsync:async()=>"AAECAw==",EncodingType:{Base64:"base64"}},bigatt:{MAX_ATT:100000,ATT_CHUNK:4096},
 base64ToBytes:()=>new Uint8Array(4),encryptFileBytesAsync:async()=>({ciphertext:new Uint8Array(20),key:"synthetic",iv:"synthetic"}),
 api:{blobUpload:async()=>({id:"synthetic"}),apiErr:e=>e.message},mounted:{current:true},lang:"it",t:k=>k,text:"",replyTo:null,ttl:0,convId:"synthetic",packMessage:()=>({}),
 sendChatMessage:async()=>{sends++;return sent.promise;},load:async()=>{},setSending:()=>{},setErr:()=>{},setUploadPct:()=>{},setText:()=>{},setReplyTo:()=>{},setConvId:()=>{}};
const attach=vm.runInNewContext(`(${generate(handler).code})`,context);
const upload=attach();await attach();assert.equal(picks,1,"picker opens without waiting for network consent");assert.equal(checks,1,"send still requires consent");
consent.resolve(true);while(!sends)await new Promise(r=>setImmediate(r));
await attach();assert.equal(picks,1);assert.equal(sends,1,"guard lasts through upload and send");
sent.resolve({});await upload;assert.equal(context.documentFlow.current,false);
await attach();assert.equal(picks,2,"next intentional selection is allowed");

context.maySendToContact=async()=>false;
await attach();assert.equal(context.documentFlow.current,false);assert.equal(picks,3);
context.maySendToContact=async()=>{throw new Error("consent failed");};
await attach();assert.equal(context.documentFlow.current,false);assert.equal(picks,4);

const root = new URL("../node_modules/expo-document-picker/android/src/main/java/expo/modules/documentpicker/DocumentPickerModule.kt",import.meta.url);
const patched=fs.readFileSync(root,"utf8");assert.equal(patchDocumentPicker(patched),patched,"native patch is idempotent");
assert.match(patched,/catch \(error: Exception\) \{\s+pendingPromise = null\s+throw error/);
assert.throws(()=>patchDocumentPicker("changed upstream source"),/Unexpected/);
for(const name of fs.readdirSync(new URL("../src/screens",import.meta.url))){
 if(name.endsWith('.js'))assert.ok(!fs.readFileSync(new URL('../src/screens/'+name,import.meta.url),'utf8').includes('from "expo-document-picker"'),name+' bypasses the app-wide gate');
}
clearLockSuppress();
console.log("Document picker: repeated taps, one native launch/result, cancellation, errors, retry, PIN transition guard, chat upload lifetime and native launch cleanup verified.");
