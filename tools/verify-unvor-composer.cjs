const fs=require('fs'),vm=require('vm'),assert=require('assert/strict'),babel=require('@babel/core'),parser=require('@babel/parser');
const filename='src/screens/ChatScreen.js',raw=fs.readFileSync(filename,'utf8'),ast=parser.parse(raw,{sourceType:'module',plugins:['jsx']});
const imports=ast.program.body.filter(n=>n.type==='ImportDeclaration').flatMap(n=>n.specifiers.map(s=>s.local.name));
ast.program.body=ast.program.body.filter(n=>n.type!=='ImportDeclaration').map(n=>n.type==='ExportDefaultDeclaration'?n.declaration:n);
const code=babel.transformFromAstSync(ast,raw,{babelrc:false,configFile:false,plugins:['@babel/plugin-transform-react-jsx']}).code;
const noop=()=>{},states=[];let cursor=0;const element=(type,props,...children)=>({type,props:props||{},children:children.flat(Infinity).filter(Boolean)});
const ctx=Object.fromEntries(imports.map(name=>[name,()=>({})]));
Object.assign(ctx,{React:{createElement:element,Fragment:'Fragment'},Map,Set,Promise,Date,JSON,Math,require:()=>({}),setTimeout,clearTimeout,
 useState:value=>{const i=cursor++;if(!(i in states))states[i]=typeof value==='function'?value():value;return[states[i],value=>{states[i]=typeof value==='function'?value(states[i]):value;}];},
 useRef:current=>({current}),useEffect:noop,useFocusEffect:noop,useMemo:f=>f(),useCallback:f=>f,usePoll:noop,useActivePoll:noop,
 useAuth:()=>({user:{lns:'me@ultron.uns',server:'pilot',kem:{}}}),useI18n:()=>({t:k=>k,lang:'it'}),useUnread:()=>({refresh:noop}),useSafeAreaInsets:()=>({bottom:24}),useHeaderHeight:()=>56,useTint:()=> '#00d4ff',
 useAudioRecorder:()=>({}),useAudioRecorderState:()=>({isRecording:false}),RecordingPresets:{HIGH_QUALITY:{}},useMessagePreferences:()=>({hidden:[],pinned:[]}),
 hostedRatchetPilot:()=>true,DEFAULT_SERVER:'pilot',api:{getServerUrl:()=> 'pilot',pulseTyping:async()=>{},pulseTypingSet:async()=>{}},
 appearance:{get:()=>({accent:'a',bg:'b'}),ACCENTS:[{id:'a',color:'#0cf'}],BACKGROUNDS:[{id:'b',color:'#06121d'}]},theme:{},StyleSheet:{create:o=>o},
 readPollPacket:()=>null});
vm.runInNewContext(code+'\nthis.screen=ChatScreen;',ctx);
function find(n,id){if(!n||typeof n!=='object')return null;if(n.props?.testID===id)return n;for(const child of n.children||[]){const hit=find(child,id);if(hit)return hit;}return null;}
const navigation={isFocused:()=>true},route={params:{conv_id:'a'.repeat(64),others:['peer@ultron.uns']}};
const render=()=>{cursor=0;return ctx.screen({route,navigation});};
let tree=render();assert.ok(find(tree,'chat-input'));assert.ok(find(tree,'chat-attach'));assert.ok(find(tree,'chat-mic'));assert.equal(find(tree,'chat-send'),null);
find(tree,'chat-input').props.onChangeText('Hello');tree=render();assert.ok(find(tree,'chat-send'));assert.equal(find(tree,'chat-mic'),null);
assert.equal(find(tree,'chat-input').props.submitBehavior,'newline');assert.equal(find(tree,'chat-input').props.onSubmitEditing,undefined);
assert.ok(!raw.includes('setTimeout(() => scrollToEnd'));
console.log('Conversation mounts; microphone switches to Send, Enter inserts a newline, attachment button exists, and delayed focus scrolling is removed.');
