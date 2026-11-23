const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),babel=require('@babel/core');
const transpile=s=>babel.transformSync(s,{configFile:false,babelrc:false,plugins:['@babel/plugin-transform-react-jsx']}).code;
const matcher={};vm.runInNewContext(fs.readFileSync('src/lib/searchContent.js','utf8').replace('export function','function')+'\nthis.match=matchSearchContent;',matcher);
assert.deepEqual(JSON.parse(JSON.stringify(matcher.match('hello',[{name:'REPORT.PDF'}],'report'))),{text:'hello',files:['REPORT.PDF']});
assert.equal(matcher.match('hello',[],'absent'),null);

const source=fs.readFileSync('src/screens/GlobalSearchScreen.js','utf8').replace(/^import .*?;\n/gms,'').replace('export default function GlobalSearchScreen','function GlobalSearchScreen');
const element=(type,props,...children)=>({type,props:props||{},children:children.flat(Infinity).filter(Boolean)});
const group={id:'g',since:0,name:'Team',pilot:true};
async function run({cancel=false,revoke=false}={}) {
 let cursor=0;const slots=['report','report',[],[group],[],false,'','',false], refs=[],calls=[];
 const user={lns:'me',server:'test',kem:{}};
 const context={React:{createElement:element},useState(initial){const i=cursor++;if(!(i in slots))slots[i]=initial;return[slots[i],v=>{slots[i]=v}];},
 useRef(initial){const i=cursor++;return refs[i]||(refs[i]={current:initial});},useEffect:()=>{},useMemo:f=>f(),useCallback:f=>f,
 useI18n:()=>({lang:'it',t:x=>x}),useAuth:()=>({user}),View:'View',Text:'Text',TextInput:'TextInput',TouchableOpacity:'TouchableOpacity',FlatList:'FlatList',ActivityIndicator:'ActivityIndicator',SafeAreaView:'SafeAreaView',Ionicons:'Ionicons',Avatar:'Avatar',
 StyleSheet:{create:o=>o},Keyboard:{dismiss(){}},Alert:{alert(){}},theme:{},setTimeout,clearTimeout,
 hiddenMessageIds:async(_,scope)=>scope.startsWith('direct:')?['hidden']:['2'],
 api:{authenticatedScope:()=>()=>{if(revoke)throw Error('session revoked');},convs:async()=>[{conv_id:'c',others:['peer']}],messages:async()=>[
 {message_id:'one',ratchet:true,envelope:{},payload:{text:'report message',atts:[]}},
 {message_id:'file',ratchet:true,envelope:{},payload:{text:'attachment',atts:[{name:'report.pdf'}]}},
 {message_id:'hidden',ratchet:true,envelope:{},payload:{text:'report hidden'}},
 {message_id:'deleted',hidden:true,envelope:{},payload:{text:'report deleted'}}]},
 hostedRatchetPilot:()=>true,readPilotMessage:async(m,_,options)=>{assert.equal(options.offline,true);calls.push(m.message_id);if(cancel)context.change('new query');return m.payload;},
 decryptAny:async()=>{throw Error('legacy decrypt must not run');},unpackMessage:x=>x,
 matchSearchContent:matcher.match,pilotGroupPolicy:async()=>({hidden:[3]}),cachedPilotGroupDetails:async()=>({title:'Team',members:['me'],history:[{seq:1,body:'report group'},{seq:2,body:'report hidden'},{seq:3,body:'report removed'},{seq:4,body:'file',attachment:{name:'report.png'}}]}),presentPilotGroupHistory:x=>x,
 };
 vm.runInNewContext(transpile(source+'\nthis.screen=GlobalSearchScreen;'),context);
 const tree=context.screen({navigation:{replace(){},goBack(){}}});
 function find(n,pred){if(!n||typeof n!=='object')return;if(pred(n))return n;for(const c of n.children||[]){const got=find(c,pred);if(got)return got;}}
 context.change=find(tree,n=>n.props.testID==='global-search-input').props.onChangeText;
 const list=find(tree,n=>n.type==='FlatList');const row=list.props.renderItem({item:{type:'msgcta'}});
 await row.props.onPress();
 if(cancel||revoke)assert.equal(slots[4].length,0);
 else {
  assert.deepEqual([...slots[4].map(h=>h.id)],['c:one','c:file','g:1','g:4']);
  assert.deepEqual(calls,['one','file']);
  assert.equal(slots[4][1].files[0],'report.pdf');
 }
}
(async()=>{await run();await run({cancel:true});await run({revoke:true});console.log('UNVOR search: filenames, ratchet offline reads, group history, hidden/deleted exclusion, query cancellation and revoked sessions verified.');})().catch(e=>{console.error(e);process.exitCode=1});
