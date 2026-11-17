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
import { analyzeMessage, scanUrl, setThreatDomains, URL_RE } from "../src/lib/threatEngine.js";
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
const notices = [];
let registrationError = false, failedRegistrations = 0;
let actor, loseOnce = false, conflictOnce = false, loseCreate = true, claims = 0;
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
  mlsGroupInvitations: async group => [...invites.values()].filter(row=>row.group===group && row.inviter===actor.lns && row.status!=="joined"),
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
  mlsAppend: async (id, body, silent) => {
    const group=groups.get(id);
    if (!group.members.has(actor.lns)) throw missing();
    const found=group.events.find(e=>e.author===actor.lns&&e.op===body.op);
    if(found) return {seq:found.seq,epoch:found.next_epoch};
    if (conflictOnce) { conflictOnce = false; throw conflict(); }
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
    group.events.push({...body,silent,seq,next_epoch:next,author:actor.lns,subject:body.target});
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
const app=runInNewContext(source+"\n({cachedPilotGroupSummary,listPilotGroups,preparePilotGroupInvites,deliverPilotGroupInvitation,createPilotGroup,finishAcceptedPilotGroupInvites,openPilotGroup,updatePilotGroup,presentPilotGroupHistory,listPublicPilotGroups,pilotInvitationInbox,pilotInvitationTitle,requestPilotGroupInvitation,decidePilotGroupInvitation})",{
  ...cryptoLib,api,registerHostedRatchet:async()=>{ if (registrationError) { failedRegistrations++; throw new Error("registration unavailable"); } },
  sendPilotMessage:async(payload,user,peer,{receiptName})=>{
    assert.equal(actor,user);
    notices.push({payload,peer});
    appData.set(receiptName,{done:true});
  },verifiedContact:async(_user,peer)=>({kem:cryptoLib.bytesToHex(users.get(peer).kem.publicKey)}),createMlsGroupEngine,hostedGroupCredentials,mls,defaultClientConfig,
  getBlob:async key=>structuredClone(appData.get(key)),
  setBlobDurably:async (key,data)=>appData.set(key,structuredClone(data)),
  setBlobsDurably:async entries=>{ for (const [key,data] of entries) appData.set(key,structuredClone(data)); },
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
await assert.rejects(app.updatePilotGroup(a,row,"message","In attesa",undefined,randomHex(16)), /Invita almeno un membro/);
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
await app.finishAcceptedPilotGroupInvites(a,row);
const repairedAt = groups.get(row.id).seq;
await app.finishAcceptedPilotGroupInvites(a,row);
assert.equal(groups.get(row.id).seq,repairedAt,"Already published profiles must not be sent again");
actor=b;
assert.equal((await app.openPilotGroup(b,bobRow)).title,"Collaudo");
assert.equal((await app.cachedPilotGroupSummary(b,bobRow)).unread,1);
await app.openPilotGroup(b,bobRow,{read:true});
assert.equal((await app.cachedPilotGroupSummary(b,bobRow)).unread,0);
await assert.rejects(app.updatePilotGroup(b,bobRow,"profile",{description:"Contraffatta",avatar:null}), /non valido/);
actor=a;
const groupProfile={description:"Informazioni riservate del gruppo",visibility:"private",avatar:"data:image/jpeg;base64,/9j/2Q=="};
await app.updatePilotGroup(a,row,"profile",groupProfile);
const profilePacket = groups.get(row.id).events.at(-1).wire;
assert.ok(!profilePacket.includes(groupProfile.description) && !profilePacket.includes(groupProfile.avatar));
conflictOnce=true;
await app.updatePilotGroup(a,row,"message","Invio dopo conflitto",undefined,randomHex(16));
actor=b;
const latest = await app.openPilotGroup(b,bobRow);
assert.deepEqual({...latest.profile},groupProfile);
assert.equal(latest.history.at(-1).body,"Invio dopo conflitto");
assert.equal((await app.cachedPilotGroupSummary(b,bobRow)).avatar,groupProfile.avatar);
actor=a;
const attachment = {name:"Prova.pdf",mime:"application/pdf",size:96*1024,data:Buffer.alloc(96*1024,123).toString("base64")};
await assert.rejects(app.updatePilotGroup(a,row,"attachment",{...attachment,size:attachment.size+1}), /non valido/);
const attachmentDraft = randomHex(16);
await app.updatePilotGroup(a,row,"attachment",attachment,undefined,attachmentDraft);
const wire = groups.get(row.id).events.at(-1).wire;
assert.ok(!wire.includes(attachment.data));
assert.ok(Buffer.from(wire,"base64").length < 384*1024);
actor=b;
assert.deepEqual({...((await app.openPilotGroup(b,bobRow)).history.at(-1).attachment)},attachment);
actor=a;
await assert.rejects(app.updatePilotGroup(a,row,"poll",{question:"Orario?",options:["Mattina","Mattina"]}), /Sondaggio non valido/);
const pollHistory = await app.updatePilotGroup(a,row,"poll",{question:"Orario?",options:["Mattina","Pomeriggio"]});
const pollId = pollHistory.history.at(-1).poll.id;
assert.equal(groups.get(row.id).events.at(-1).silent, false);
const lastWire = groups.get(row.id).events.at(-1).wire;
assert.ok(!lastWire.includes("Pomeriggio"));
actor=b;
let pollView = app.presentPilotGroupHistory((await app.openPilotGroup(b,bobRow)).history,b.lns).at(-1);
assert.equal(pollView.body,"Orario?");
assert.deepEqual(Array.from(pollView.totals),[0,0]);
await app.updatePilotGroup(b,bobRow,"vote",{id:pollId,choice:0});
await app.updatePilotGroup(b,bobRow,"vote",{id:pollId,choice:1});
assert.equal(groups.get(row.id).events.at(-1).silent, true);
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
const draft = randomHex(16);
await assert.rejects(app.updatePilotGroup(a,row,"message","Solo Alice e Carol",undefined,draft),/receipt lost/);
await app.openPilotGroup(a,row);
const delivered = await app.updatePilotGroup(a,row,"message","Solo Alice e Carol",undefined,draft);
assert.equal(delivered.history.filter(m=>m.body==="Solo Alice e Carol").length,1);
actor=b;assert.equal((await app.listPilotGroups()).length,0);
await assert.rejects(app.openPilotGroup(b,bobRow));
actor=c;
assert.equal((await app.openPilotGroup(c,carolRow)).history.at(-1).body,"Solo Alice e Carol");
actor=a;
const publicGroup=await app.createPilotGroup(a,"Piazza ULTRON","public");
const request=await app.requestPilotGroupInvitation(a,publicGroup,b.lns);
const notice=notices.at(-1);
assert.equal(notice.peer,b.lns);
assert.equal(cryptoLib.unpackMessage(notice.payload).text,"Invito al gruppo «Piazza ULTRON»");
assert.deepEqual(cryptoLib.unpackMessage(notice.payload).groupInvite,{id:request.id,group:publicGroup.id});
const noticeCount = notices.length;
await app.deliverPilotGroupInvitation(a,publicGroup,request);
assert.equal(notices.length,noticeCount);
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
const poolKey = "mls:" + cryptoLib.sha256Hex(JSON.stringify([b.server,b.lns,"packages"]));
const previousPool = appData.get(poolKey);
appData.delete(poolKey);
registrationError = true;
const accepted=await app.decidePilotGroupInvitation(b,anotherRequest,"accepted");
assert.equal(accepted.status,"accepted");
await assert.rejects(app.preparePilotGroupInvites(b), /registration unavailable/);
assert.ok(failedRegistrations > 0);
registrationError = false;
appData.set(poolKey,previousPool);
actor=a;
await assert.rejects(app.updatePilotGroup(a,publicGroup,"add",b.lns,{...accepted,proof:"00".repeat(3309)}),/Consenso/);
await app.finishAcceptedPilotGroupInvites(a,publicGroup);
actor=b;
const [publicMemberRow]=await app.listPilotGroups();
const publicDetails = await app.openPilotGroup(b,publicMemberRow);
assert.equal(publicDetails.title,"Piazza ULTRON");
assert.equal(publicDetails.profile.visibility,"public");
actor = a;
let replyRoot = await app.updatePilotGroup(a, publicGroup, "message", "Domanda di prova");
const replySeq = replyRoot.history.at(-1).seq;
actor = b;
await assert.rejects(app.updatePilotGroup(b, publicMemberRow, "reply", { text: "Errore", seq: 999999 }), /originale/);
const replyDetails = await app.updatePilotGroup(b, publicMemberRow, "reply", { text: "Risposta di prova", seq: replySeq });
assert.equal(replyDetails.history.at(-1).replyTo, replySeq);
actor = a;
const peerReply = (await app.openPilotGroup(a, publicGroup)).history.at(-1);
assert.equal(peerReply.replyTo, replySeq);
assert.equal(peerReply.body, "Risposta di prova");

console.log("Direct chat notice, delivery receipt and acceptance with delayed key publishing passed.");
console.log("Three pilot clients: create, invite, signed text, scoped title, encrypted polls, signed consent, public listing, unread counts, encrypted profile and attachment, automatic invitation completion, removal and durable send retry passed.");

// Execute the first render of both group routes to catch errors Babel alone
// cannot detect, including access to a hook value before its initialization.
const { createRequire } = await import("node:module");
const require = createRequire(import.meta.url);
const babel = require("@babel/core");
const jsx = require("@babel/plugin-transform-react-jsx");
const screenSource = readFileSync(new URL("../src/screens/PilotGroupsScreen.js", import.meta.url), "utf8")
  .replace(/^import\s+[\s\S]*?\sfrom\s+"[^"]+";\s*$/gm, "")
  .replace(/^export default /m, "");
const screen = babel.transformSync(screenSource, { babelrc: false, configFile: false, plugins: [jsx] }).code;
const view = name => name;
const renderGroup = runInNewContext(screen + "\nPilotGroupsScreen", {
  React: { createElement: (...args) => args, Fragment: "Fragment" },
  useState: initial => [typeof initial === "function" ? initial() : initial, () => {}],
  useRef: current => ({ current }), useMemo: callback => callback(), useCallback: callback => callback,
  useEffect: () => {}, useLayoutEffect: () => {}, useFocusEffect: () => {}, usePoll: () => {},
  useAuth: () => ({ user: a }), useI18n: () => ({ lang: "it" }), useSafeAreaInsets: () => ({ top: 24, bottom: 48 }),
  presentPilotGroupHistory: app.presentPilotGroupHistory, StyleSheet: { create: value => value }, theme: {},
  Ionicons: view("Ionicons"), Text: view("Text"), TextInput: view("TextInput"), View: view("View"),
  ScrollView: view("ScrollView"), TouchableOpacity: view("TouchableOpacity"), ActivityIndicator: view("ActivityIndicator"),
  KeyboardAvoidingView: view("KeyboardAvoidingView"), FlatList: view("FlatList"),
  SafeText: view("SafeText"), ThreatBanner: view("ThreatBanner"), analyzeMessage,
  RecordingPresets: { HIGH_QUALITY: {} }, useAudioRecorder: () => ({}), useAudioRecorderState: () => ({}),
  useMessagePreferences: () => ({ hidden: [], pinned: [] }),
});
for (const params of [{}, { group: row }, { inviteCode: "a".repeat(64) + "." + "b".repeat(64) }]) {
  assert.ok(renderGroup({ navigation: {}, route: { params } }));
}
console.log("Group list, conversation and invitation routes mount without runtime initialization errors.");

function findView(element, match) {
  if (!Array.isArray(element)) return null;
  if (match(element)) return element;
  for (const child of element) {
    const found = findView(child, match);
    if (found) return found;
  }
  return null;
}
const groupChat = renderGroup({ navigation: {}, route: { params: { group: row } } });
const [, groupList] = findView(groupChat, node => node[0] === "FlatList");
const link = "https://example.org/health";
const message = "Conferma le tue credenziali: http://192.0.2.1/login";
const messageRow = groupList.renderItem({ item: { seq: 1, sender: b.lns, body: message } });
assert.equal(findView(messageRow, node => node[0] === "SafeText")?.[1]?.text, message);
const banner = findView(messageRow, node => node[0] === "ThreatBanner")?.[1];
assert.equal(banner?.logLocally, false);
assert.equal(banner?.result.level, "danger");

const safeTextSource = readFileSync(new URL("../src/components/SafeText.js", import.meta.url), "utf8")
  .replace(/^import\s+[^\n]+;\s*$/gm, "").replace(/^export default /m, "");
const safeTextScript = babel.transformSync(safeTextSource, { babelrc: false, configFile: false, plugins: [jsx] }).code;
const opened = [];
let alertButtons;
const renderSafeText = runInNewContext(safeTextScript + "\nSafeText", {
  React: { createElement: (...args) => args }, Text: "Text", StyleSheet: { create: value => value },
  URL_RE, scanUrl, Linking: { openURL: async url => { opened.push(url); } },
  Alert: { alert: (_title, _body, buttons) => { alertButtons = buttons; } },
});
const pressLink = (node, id) => findView(node, element => element[1]?.testID === id)[1].onPress();
pressLink(renderSafeText({ text: link }), "safe-link");
assert.deepEqual(opened, [link]);
pressLink(renderSafeText({ text: message }), "blocked-link-danger");
assert.equal(alertButtons.length, 1);
assert.deepEqual(opened, [link]);
const shortLink = "https://bit.ly/example";
pressLink(renderSafeText({ text: shortLink }), "blocked-link-warn");
assert.equal(alertButtons.length, 2);
setThreatDomains(["bit.ly"]);
alertButtons[1].onPress();
assert.equal(alertButtons.length, 1);
assert.deepEqual(opened, [link]);
setThreatDomains([]);
console.log("Group text uses the local Shield, and dangerous links stay blocked even after the list changes.");
