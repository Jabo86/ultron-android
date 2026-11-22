'use strict';
// Exercise the provider with delayed endpoints, foreground events and profile changes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const babel = require('@babel/core');
const source = fs.readFileSync('src/context/UnreadContext.js', 'utf8');
const compiled = babel.transformSync(source, {
  configFile: false, babelrc: false,
  plugins: [require.resolve('@babel/plugin-transform-react-jsx'), require.resolve('@babel/plugin-transform-modules-commonjs')],
}).code;
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return {promise,resolve,reject}; };
const incoming = [{lns:'a@ultron.uns', contact_request:'incoming'}, {contact_request:'outgoing'}, {contact_request:'incoming', blocked:true}];
async function test(pilot) {
  const slots = [], effects = [], timers = new Map();
  let cursor=0, dirty=false, timerId=0, listener, value;
  let user={lns:'recipient@ultron.uns'};
  let contactCalls=0, contacts=deferred();
  const slowChat=deferred();
  const React = {
    createContext: () => ({Provider:'provider'}),
    useContext: () => value,
    useState(initial) { const i=cursor++; if (!(i in slots)) slots[i]=initial; return [slots[i], next => { slots[i]=next; dirty=true; }]; },
    useRef(initial) { const i=cursor++; if (!(i in slots)) slots[i]={current:initial}; return slots[i]; },
    useMemo(fn,deps) { const i=cursor++; const old=slots[i]; if (!old || deps.some((d,j)=>!Object.is(d,old.deps[j]))) slots[i]={deps,value:fn()}; return slots[i].value; },
    useCallback(fn,deps) { return React.useMemo(()=>fn,deps); },
    useEffect(fn,deps) { const i=cursor++; const old=slots[i]; if (!old || deps.some((d,j)=>!Object.is(d,old.deps[j]))) { effects.push(()=>{old?.cleanup?.(); slots[i]={deps,cleanup:fn()};}); } },
    createElement(type,props) { value=props.value; return null; },
  };
  const AppState={currentState:'active', addEventListener(_,fn) { listener=fn; return {remove(){}}; }};
  const mocks={react:React,'react-native':{AppState},'../config':{RATCHET_PILOT:pilot},'./AuthContext':{useAuth:()=>({user})},'../lib/canary':{isOwner:()=>false},'../lib/api':{badges:()=>slowChat.promise, contactsRaw:()=>{contactCalls++; return contacts.promise;}}};
  const context={exports:{},require(name){assert.ok(name in mocks,name); return mocks[name];},setInterval(fn,ms){timers.set(++timerId,{fn,ms});return timerId;},clearInterval(id){timers.delete(id);}};
  vm.runInNewContext(compiled,context);
  function render() { dirty=false; cursor=0; context.exports.UnreadProvider({children:null}); while(effects.length) effects.shift()(); }
  async function flush() { for(let i=0;i<10;i++) { await Promise.resolve(); if(dirty) render(); } }
  render(); await flush();
  assert.equal(contactCalls,1,'contacts start even while chat endpoint is unresolved');
  contacts.resolve(pilot ? incoming : [{they_have_me:true,in_my_book:false},{they_have_me:true,in_my_book:false,blind:true},{they_have_me:true,in_my_book:false,blocked:true}]);
  await flush(); assert.equal(value.bookRequests,1,'incoming only, excluding blocked and blind');
  contacts=deferred(); AppState.currentState='background';
  for(const t of timers.values()) if(t.ms===5000)t.fn();
  assert.equal(contactCalls,1,'no background polling');
  AppState.currentState='active'; listener('active');
  assert.equal(contactCalls,2,'resume refreshes contacts while prior chat request still pending');
  contacts.reject(Error('offline')); await flush(); assert.equal(value.bookRequests,1,'network error preserves confirmed badge');
  contacts=deferred(); for(const t of timers.values()) if(t.ms===5000)t.fn();
  contacts.resolve([]); await flush(); assert.equal(value.bookRequests,0,'accepted or rejected request removes badge');
  value.updateContactRequests(pilot ? incoming : [{they_have_me:true,in_my_book:false}]); await flush();
  assert.equal(value.bookRequests,1,'address book updates shared badge immediately');
  contacts=deferred(); for(const t of timers.values()) if(t.ms===5000)t.fn();
  value.updateContactRequests([]); await flush();
  contacts.resolve(pilot ? incoming : [{they_have_me:true,in_my_book:false}]); await flush();
  assert.equal(value.bookRequests,0,'stale polling cannot restore a request already handled in the address book');
  contacts=deferred(); for(const t of timers.values()) if(t.ms===5000)t.fn();
  const old=contacts; contacts=deferred(); user={lns:'decoy@ultron.uns'}; render(); await flush();
  old.resolve(pilot ? incoming : [{they_have_me:true,in_my_book:false}]); await flush();
  assert.equal(value.bookRequests,0,'previous profile response cannot disclose contact requests');
  contacts.resolve([]); await flush();
  for(const s of slots) s?.cleanup?.();
}
(async()=>{await test(true);await test(false);console.log('Contact badge checks passed: slow chat, foreground/resume, polling, errors, decisions and profile isolation.');})().catch(e=>{console.error(e);process.exitCode=1;});
