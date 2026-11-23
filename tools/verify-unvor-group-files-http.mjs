import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash, randomBytes} from 'node:crypto';
import {keygen,signMessage,signChallenge,randomHex} from '../src/lib/crypto.js';
const origin=process.env.UNVOR_TEST_ORIGIN || 'http://127.0.0.1:8002';
const scope=process.env.UNVOR_MLS_SCOPE || 'https://49.12.242.0/ratchet-pilot';
async function req(path,data,token,status=200,method){
 const binary=data instanceof Uint8Array;
 const response=await fetch(origin+'/api'+path,{method:method||(data===undefined?'GET':'POST'),headers:{...(token?{Authorization:'Bearer '+token}:{}),...(data!==undefined?{'Content-Type':binary?'application/octet-stream':'application/json'}:{})},body:data===undefined?undefined:binary?data:JSON.stringify(data)});
 assert.equal(response.status,status,`${path}: ${response.status} expected ${status}`);
 if(status!==200){await response.arrayBuffer();return;}
 if(response.headers.get('content-type')?.startsWith('application/octet-stream'))return response;
 return response.json();
}
async function account(){const keys=keygen(),username='unvor-file-'+randomHex(6),lns=username+'@ultron.uns';
 await req('/public/personal/signup',{username,public_key_hex:keys.publicKeyHex,signature_hex:signMessage('ultron-personal-signup-v1:'+lns,keys.secretKeyHex)});
 const challenge=await req('/public/sign-challenge',{lns_name:lns});
 const session=await req('/public/session/verify',{lns_name:lns,nonce_id:challenge.nonce_id,signature_hex:signChallenge(challenge.nonce_hex,keys.secretKeyHex)});
 return{...keys,lns,token:session.token};}
const alice=await account(), outsider=await account();
const group=randomHex(32),root='/public/pulse/mls/groups/'+group;
await req('/public/pulse/mls/groups',{id:group,signature:signMessage(JSON.stringify(['ultron-mls-group-v1',scope,group,alice.lns]),alice.secretKeyHex)},alice.token);
const total=50*1024*1024,cs=4*1024*1024,n=Math.ceil(total/cs),file=randomHex(16),url=root+'/files/'+file;
const expected=createHash('sha256');let last;
for(let index=0;index<n;index++){
 const bytes=Buffer.alloc(Math.min(cs,total-index*cs)+16,index+1);expected.update(bytes);
 last=await req(`${url}?index=${index}&parts=${n}&size=${total}`,bytes,alice.token);
 assert.equal(last.ready,index===n-1);assert.equal(last.id,file);
 if(index===0)await req(`${url}?index=0&parts=${n}&size=${total}`,bytes,alice.token);
}
await req(url,undefined,alice.token,404);
await req(url,undefined,outsider.token,404);
const event=(id,cursor,file)=>({op:id,cursor,epoch:0,kind:'message',wire:randomBytes(54).toString('base64'),file});
await req(root+'/events',event(randomHex(16),0,file),alice.token);
const download=await req(url,undefined,alice.token);assert.equal(Number(download.headers.get('content-length')),total+n*16);
const actual=createHash('sha256');let count=0;for await(const bytes of download.body){actual.update(bytes);count+=bytes.length;}
assert.equal(count,total+n*16);assert.equal(actual.digest('hex'),expected.digest('hex'));
await req(url,undefined,outsider.token,404);
await req(`${root}/files/${randomHex(16)}?index=0&parts=${n}&size=${total+1}`,Buffer.alloc(cs+16),alice.token,413);
await req(`${url}?index=0&parts=${n}&size=${total}`,Buffer.alloc(cs+16,9),alice.token,409);
const partial=randomHex(16);await req(`${root}/files/${partial}?index=0&parts=2&size=${cs*2}`,Buffer.alloc(cs+16),alice.token);
await req(root+'/events',event(randomHex(16),1,partial),alice.token,404);
await req(root+'/control',{},alice.token,200,'DELETE');
await req(url,undefined,alice.token,404);
console.log('Gateway: exact 50 MiB upload/download, retry identity, over-limit rejection, incomplete publication, outsider isolation and group deletion verified.');

const dbContainer=process.env.UNVOR_TEST_MONGO_CONTAINER;
if(dbContainer){
 const rid=randomHex(32);
 await req('/public/pulse/wake/register',{rid},alice.token);
 const db=code=>execFileSync('docker',['exec',dbContainer,'mongosh','--quiet','unvor_attachment_test','--eval',code]);
 const a='100000000000000000000001',b='100000000000000000000002';
 const insert=id=>db('db.ultron_mobile_messages.insertOne({_id:ObjectId('+JSON.stringify(id)+'),to_lns:'+JSON.stringify(alice.lns)+',delivered:false,silent:false})');
 const poll=()=>req('/public/wake/poll?rid='+rid+'&wait=0');
 insert(a);let response=await poll();assert.equal(response.message_notice,a);assert.equal(response.n,1);
 assert.equal((await poll()).message_notice,a,'same message retains its identity');
 db('db.ultron_mobile_messages.updateOne({_id:ObjectId('+JSON.stringify(a)+')},{$set:{delivered:true}})');
 assert.equal((await poll()).message_notice,null);
 insert(b);response=await poll();assert.equal(response.message_notice,b);assert.equal(response.n,1,'same count, genuinely new message');
 console.log('Wake: stable message identity, repeated polling, delivery then new message at the same count verified.');
}
