import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { defaultClientConfig } from "ts-mls/clientConfig.js";
import * as mls from "ts-mls";
import { randomHex, keygen } from "../src/lib/crypto.js";
import { createMlsSubtleCrypto } from "../src/lib/mlsMobileCrypto.js";
import { groupAuthenticationService, signGroupCredential } from "../src/lib/groupMemberProof.js";
import { createMlsGroupEngine } from "../src/lib/mlsGroupEngine.js";

Object.defineProperty(globalThis, "crypto", {
  value: { getRandomValues: webcrypto.getRandomValues.bind(webcrypto), subtle: createMlsSubtleCrypto() },
});
const server = "https://pilot.invalid/ratchet-pilot";
const known = new Map();
async function client(name, registered=true) {
  const key = keygen();
  const lns = `${name}@ultron.uns`;
  const device = randomHex(16);
  if (registered) known.set(`${lns}:${device}`, key.publicKeyHex);
  const creds = {
    authService: groupAuthenticationService(server, async (account, installation) => known.get(`${account}:${installation}`)),
    createCredential: publicKey => ({credentialType:"basic", identity:signGroupCredential({server,lns,sk:key.secretKeyHex},device,publicKey)}),
  };
  return { lns, engine:await createMlsGroupEngine(mls,defaultClientConfig,creds) };
}
const id = randomHex(32);
const a = await client("alice"), b = await client("bob"), c = await client("carol"), spoof = await client("bob",false);
const admin=a.lns;
let alice = await a.engine.create(id);
const invalid = await spoof.engine.createKeyPackage();
await assert.rejects(a.engine.change(alice,id,0,"add",b.lns,invalid.wire));
const bobKey = await b.engine.createKeyPackage();
const first = await a.engine.change(alice,id,0,"add",b.lns,bobKey.wire);
assert.ok(first.welcome);
alice=first.snapshot;
let bob = await b.engine.join(id,1,first.welcome,bobKey,admin);
const privateMessage=await a.engine.send(alice,id,1,"prima dell'ingresso");
alice=privateMessage.snapshot;
const event=(kind,epoch,wire,subject,author=admin)=>({kind,epoch,next_epoch:epoch+(kind==="message"?0:1),wire,subject,author});
const previous=event("message",1,privateMessage.wire,null);
const delivered=await b.engine.receive(bob,id,1,previous,admin);
assert.equal(delivered.payload,"prima dell'ingresso");
bob=delivered.snapshot;
const carolKey = await c.engine.createKeyPackage();
const second = await a.engine.change(alice,id,1,"add",c.lns,carolKey.wire);
alice=second.snapshot;
await assert.rejects(b.engine.receive(bob,id,1,event("add",1,second.wire,b.lns),admin));
await assert.rejects(b.engine.receive(bob,id,1,event("add",1,second.wire,c.lns,b.lns),admin));
bob=(await b.engine.receive(bob,id,1,event("add",1,second.wire,c.lns),admin)).snapshot;
let carol=await c.engine.join(id,2,second.welcome,carolKey,admin);
await assert.rejects(c.engine.receive(carol,id,2,previous,admin));
await assert.rejects(c.engine.receive(carol,id,2,{...previous,epoch:2,next_epoch:2},admin));
const removed=await a.engine.change(alice,id,2,"remove",b.lns);
alice=removed.snapshot;
carol=(await c.engine.receive(carol,id,2,event("remove",2,removed.wire,b.lns),admin)).snapshot;
const fresh = await a.engine.send(alice,id,3,"dopo rimozione");
const later = event("message",3,fresh.wire,null);
assert.equal((await c.engine.receive(carol,id,3,later,admin)).payload,"dopo rimozione");
await assert.rejects(b.engine.receive(bob,id,2,later,admin));
await assert.rejects(b.engine.receive(bob,id,2,{...later,epoch:2,next_epoch:2},admin));
console.log("Group engine passed MLS join, spoof rejection, history separation and removal in the mobile-crypto runtime.");
