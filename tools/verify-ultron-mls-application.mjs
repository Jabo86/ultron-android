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
  users.set(lns, {server,lns,sk:keys.secretKeyHex,pk:keys.publicKeyHex,kem:cryptoLib.deriveKemKeypair(keys.secretKeyHex),device:randomHex(16)});
}
const [a,b,c] = users.values();
const appData = new Map(), groups = new Map(), packages = new Map(), invites = new Map();
let actor, loseOnce = false, loseCreate = true, claims = 0;
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
    claims++;
    const item = [...packages.values()].find(p => p.owner===peer && (p.op===op || !p.op));
    if (!item) throw missing();
    item.op=op;
    return item;
  },
  mlsGroups: async () => [...groups.values()].filter(item=>item.members.has(actor.lns))
    .map(({id,signature,admin,seq,epoch,members})=>({id,signature,admin,seq,epoch,since:members.get(actor.lns)})),
  mlsRequestInvitation: async (group, {id,target,note}) => {
    assert.equal(groups.get(group).admin,actor.lns);
    const row = {id,group,target,note,inviter:actor.lns,status:"pending"};
    invites.set(id,row);
    return {...row};
  },
  mlsInvitations: async () => [...invites.values()].filter(row=>row.target===actor.lns && row.status!=="joined"),
  mlsDecideInvitation: async (id,{decision,signature}) => {
    const row = invites.get(id);
    assert.equal(row.target,actor.lns);
    const payload=JSON.stringify(["ultron-mls-consent-v1",server,row.group,row.id,row.inviter,row.target,decision]);
    assert.ok(cryptoLib.verifyMessage(payload,signature,actor.pk));
    row.status=decision;
    row.proof=signature;
    return {...row};
  },
  mlsPublicGroups: async () => [...groups.values()].filter(row=>row.listing).map(row=>({id:row.id,admin:row.admin,name:row.listing.name})),
  mlsCreate: async ({id,signature,listing}) => {
    if (listing) assert.ok(cryptoLib.verifyMessage(JSON.stringify(["ultron-mls-listing-v1",server,id,actor.lns,listing.name]),listing.signature,actor.pk));
    if (!groups.has(id)) groups.set(id,{id,signature,listing,admin:actor.lns,seq:0,epoch:0,members:new Map([[actor.lns,0]]),events:[]});
    if (loseCreate) { loseCreate = false; throw new Error("create receipt lost"); }
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
    const seq=group.seq+1;
    const next = body.kind==="message"?group.epoch:group.epoch+1;
    if (body.kind==="add") {
      if (group.listing) {
        const invite=invites.get(body.invitation);
        if (!invite || invite.status!=="accepted" || invite.target!==body.target) throw missing();
        invite.status="joined";
        body={...body,consent:invite.proof};
      }
      group.members.set(body.target,seq);
    }
    if (body.kind==="remove") group.members.delete(body.target);
    group.events.push({...body,seq,next_epoch:next,author:actor.lns,subject:body.target});
    group.epoch=next;
    group.seq=seq;
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
const app=runInNewContext(source+"\n({listPilotGroups,preparePilotGroupInvites,createPilotGroup,openPilotGroup,updatePilotGroup,presentPilotGroupHistory,listPublicPilotGroups,pilotInvitationInbox,pilotInvitationTitle,requestPilotGroupInvitation,decidePilotGroupInvitation})",{
  ...cryptoLib,api,registerHostedRatchet:async()=>{},verifiedContact:async(_user,peer)=>({kem:cryptoLib.bytesToHex(users.get(peer).kem.publicKey)}),createMlsGroupEngine,hostedGroupCredentials,mls,defaultClientConfig,
  getBlob:async key=>structuredClone(appData.get(key)),
  setBlobDurably:async (key,data)=>appData.set(key,structuredClone(data)),
});
actor=b;await app.preparePilotGroupInvites(b);
actor=c;await app.preparePilotGroupInvites(c);
actor=a;
await assert.rejects(app.createPilotGroup(a, "Collaudo"), /create receipt lost/);
const [originalId] = groups.keys();
const row = await app.createPilotGroup(a, "Collaudo");
assert.equal(row.id, originalId);
assert.equal(row.title, "Collaudo");
assert.equal(groups.size, 1);
await app.updatePilotGroup(a,row,"title","Collaudo");
await app.updatePilotGroup(a,row,"add",b.lns);
const initialClaims = claims;
await app.updatePilotGroup(a,row,"add",b.lns);
assert.equal(claims, initialClaims);
assert.equal(groups.size, 1);
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
actor=a;
await assert.rejects(app.updatePilotGroup(a,row,"poll",{question:"Orario?",options:["Mattina","Mattina"]}), /Sondaggio non valido/);
const pollHistory = await app.updatePilotGroup(a,row,"poll",{question:"Orario?",options:["Mattina","Pomeriggio"]});
const pollId = pollHistory.history.at(-1).poll.id;
const lastWire = groups.get(row.id).events.at(-1).wire;
assert.ok(!lastWire.includes("Pomeriggio"));
actor=b;
let pollView = app.presentPilotGroupHistory((await app.openPilotGroup(b,bobRow)).history,b.lns).at(-1);
assert.equal(pollView.body,"Orario?");
assert.deepEqual(Array.from(pollView.totals),[0,0]);
await app.updatePilotGroup(b,bobRow,"vote",{id:pollId,choice:0});
await app.updatePilotGroup(b,bobRow,"vote",{id:pollId,choice:1});
actor=a;
pollView = app.presentPilotGroupHistory((await app.openPilotGroup(a,row)).history,a.lns).at(-1);
assert.deepEqual(Array.from(pollView.totals),[0,1]);
assert.equal(pollView.choice,undefined);
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
actor=a;
const publicGroup=await app.createPilotGroup(a,"Piazza ULTRON","public");
const request=await app.requestPilotGroupInvitation(a,publicGroup,b.lns);
actor=b;
assert.deepEqual(Array.from(await app.listPublicPilotGroups(b),item=>item.name),["Piazza ULTRON"]);
assert.equal((await app.listPilotGroups()).length,0);
const [received]=await app.pilotInvitationInbox(b);
assert.equal(received.id,request.id);
assert.equal(await app.pilotInvitationTitle(b,received),"Piazza ULTRON");
assert.equal((await app.decidePilotGroupInvitation(b,received,"declined")).status,"declined");
actor=a;
const anotherRequest=await app.requestPilotGroupInvitation(a,publicGroup,b.lns);
actor=b;
const accepted=await app.decidePilotGroupInvitation(b,anotherRequest,"accepted");
actor=a;
await assert.rejects(app.updatePilotGroup(a,publicGroup,"add",b.lns,{...accepted,proof:"00".repeat(3309)}),/Consenso/);
await app.updatePilotGroup(a,publicGroup,"add",b.lns,accepted);
await app.updatePilotGroup(a,publicGroup,"title","Piazza ULTRON");
actor=b;
const [publicMemberRow]=await app.listPilotGroups();
assert.equal((await app.openPilotGroup(b,publicMemberRow)).title,"Piazza ULTRON");
console.log("Three pilot clients: create, invite, signed text, scoped title, encrypted polls, signed consent, public listing, removal and durable send retry passed.");
