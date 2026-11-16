import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { webcrypto } from "node:crypto";
import { defaultClientConfig } from "ts-mls/clientConfig.js";
import * as mls from "ts-mls";
import * as cryptoLib from "../src/lib/crypto.js";
import { createMlsSubtleCrypto } from "../src/lib/mlsMobileCrypto.js";
import { groupAuthenticationService, signGroupCredential } from "../src/lib/groupMemberProof.js";
import { createMlsGroupEngine } from "../src/lib/mlsGroupEngine.js";
const { randomHex, keygen } = cryptoLib;
Object.defineProperty(globalThis, "crypto", {
  value: { getRandomValues: webcrypto.getRandomValues.bind(webcrypto), subtle: createMlsSubtleCrypto() },
});
const server = "https://pilot.invalid/ratchet-pilot";
const users = new Map();
for (const n of ["alice", "bob", "carol"]) {
  const keys = keygen(), lns = `${n}@ultron.uns`;
  users.set(lns, {server,lns,sk:keys.secretKeyHex,pk:keys.publicKeyHex,device:randomHex(16)});
}
const [a,b,c] = users.values();
const appData = new Map(), groups = new Map(), packages = new Map();
let actor, loseOnce = false;
const missing = () => Object.assign(new Error("missing"),{response:{status:404}});
const conflict = () => Object.assign(new Error("stale"),{response:{status:409}});
const api = {
  authenticatedScope: user => () => assert.equal(user,actor),
  mlsPublishPackage: async wire => {
    const id=cryptoLib.sha256Hex(actor.lns+wire);
    if (!packages.has(id)) packages.set(id,{id,wire,owner:actor.lns});
    return {id};
  },
  mlsClaimPackage: async (peer, op) => {
    const item = [...packages.values()].find(p => p.owner===peer && (p.op===op || !p.op));
    if (!item) throw missing();
    item.op=op;
    return item;
  },
  mlsGroups: async () => [...groups.values()].filter(item=>item.members.has(actor.lns))
    .map(({id,signature,admin,seq,epoch,members})=>({id,signature,admin,seq,epoch,since:members.get(actor.lns)})),
  mlsCreate: async ({id,signature}) => {
    if (!groups.has(id)) groups.set(id,{id,signature,admin:actor.lns,seq:0,epoch:0,members:new Map([[actor.lns,0]]),events:[]});
    return {id};
  },
  mlsEvents: async (id,cursor) => {
    const g = groups.get(id), since = g.members.get(actor.lns);
    if (since === undefined) throw missing();
    const events = g.events.filter(e=>e.seq>Math.max(cursor,since-1)).slice(0,8).map(e => ({
      ...e, welcome_signature:e.seq===since&&e.subject===actor.lns?e.welcome_signature:null, welcome:e.seq===since&&e.subject===actor.lns?e.welcome:null,
      package:e.seq===since&&e.subject===actor.lns?e.package:null,
      wire:e.seq===since&&e.subject===actor.lns?null:e.wire,
    }));
    return {seq:g.seq,epoch:g.epoch,since,events};
  },
  mlsAppend: async (id, body) => {
    const group=groups.get(id);
    if (!group.members.has(actor.lns)) throw missing();
    const found=group.events.find(e=>e.author===actor.lns&&e.op===body.op);
    if(found) return {seq:found.seq,epoch:found.next_epoch};
    if (body.epoch!==group.epoch||body.cursor!==group.seq) throw conflict();
    if (body.kind !== "message") assert.equal(actor.lns,group.admin);
    const seq=++group.seq;
    const next = body.kind==="message"?group.epoch:group.epoch+1;
    if (body.kind==="add") group.members.set(body.target,seq);
    if (body.kind==="remove") group.members.delete(body.target);
    group.events.push({...body,seq,next_epoch:next,author:actor.lns,subject:body.target});
    group.epoch=next;
    if(loseOnce){loseOnce=false;throw new Error("receipt lost");}
    return {seq,epoch:next};
  },
};
const hostedGroupCredentials=async user => ({
  createCredential: publicKey=>({credentialType:"basic",identity:signGroupCredential(user,user.device,publicKey)}),
  identityFor: async account=>users.get(account)?.pk,
  authService: groupAuthenticationService(server, async (account,device)=>users.get(account)?.device===device?users.get(account).pk:null),
});
const source=readFileSync(new URL("../src/lib/pilotGroups.js", import.meta.url),"utf8")
  .replace(/^import .+;$/gm,"").replace(/^export /gm,"").replace(/let dependency;[\s\S]+?(?=function serial)/,"const loadMls=async()=>[mls,{defaultClientConfig}];\n");
const app=runInNewContext(source+"\n({listPilotGroups,preparePilotGroupInvites,createPilotGroup,openPilotGroup,updatePilotGroup})",{
  ...cryptoLib,api,registerHostedRatchet:async()=>{},createMlsGroupEngine,hostedGroupCredentials,mls,defaultClientConfig,
  getBlob:async key=>structuredClone(appData.get(key)),
  setBlobDurably:async (key,data)=>appData.set(key,structuredClone(data)),
});
actor=b;await app.preparePilotGroupInvites(b);
actor=c;await app.preparePilotGroupInvites(c);
actor=a;const row=await app.createPilotGroup(a);
await app.updatePilotGroup(a,row,"title","Collaudo");
await app.updatePilotGroup(a,row,"add",b.lns);
await app.updatePilotGroup(a,row,"message","Solo Alice e Bob");
actor=b;const [bobRow]=await app.listPilotGroups();
const bobInvitation = groups.get(row.id).events.find(e => e.subject === b.lns);
const welcomeSignature = bobInvitation.welcome_signature;
bobInvitation.welcome_signature = "00".repeat(3309);
await assert.rejects(app.openPilotGroup(b,bobRow), /Firma dell’invito/);
bobInvitation.welcome_signature = welcomeSignature;
const joined=await app.openPilotGroup(b,bobRow);
assert.equal(joined.history[0].body,"Solo Alice e Bob");
assert.equal(joined.title,undefined);
actor=a;await app.updatePilotGroup(a,row,"add",c.lns);
await app.updatePilotGroup(a,row,"title","Collaudo");
actor=c;const [carolRow]=await app.listPilotGroups();
const added=await app.openPilotGroup(c,carolRow);
assert.equal(added.history.length,0);
assert.equal(added.title,"Collaudo");
actor=a;await app.updatePilotGroup(a,row,"remove",b.lns);
loseOnce=true;
await assert.rejects(app.updatePilotGroup(a,row,"message","Solo Alice e Carol"),/receipt lost/);
assert.equal((await app.openPilotGroup(a,row)).history.filter(m=>m.body==="Solo Alice e Carol").length,1);
actor=b;assert.equal((await app.listPilotGroups()).length,0);
await assert.rejects(app.openPilotGroup(b,bobRow));
actor=c;
assert.equal((await app.openPilotGroup(c,carolRow)).history.at(-1).body,"Solo Alice e Carol");
console.log("Three pilot clients: create, invite, signed text, scoped title, removal and durable send retry passed.");
