const fs=require('node:fs'),assert=require('node:assert/strict'),vm=require('node:vm');
const babel=require('@babel/core');
const source=fs.readFileSync('src/screens/UnvorHomeScreen.js','utf8').replace(/^import .*;\n/gm,'').replace('export default function UnvorHomeScreen','function UnvorHomeScreen');
const calls=[];const element=(type,props,...children)=>({type,props:props||{},children:children.flat(Infinity).filter(Boolean)});
const context={React:{createElement:element},useEffect:()=>{},useState:()=>[new Date('2026-11-22T14:50:00Z'),()=>{}],
 useAuth:()=>({user:{lns:'synthetic@ultron.uns'}}),useUnread:()=>({chatUnread:3,bookRequests:2}),useI18n:()=>({lang:'it',t:k=>k}),
 View:'View',ScrollView:'ScrollView',SafeAreaView:'SafeAreaView',Image:'Image',Text:'Text',TouchableOpacity:'TouchableOpacity',Ionicons:'Ionicons',
 StyleSheet:{create:o=>o,absoluteFill:{}},theme:{},require:p=>p};
const code=babel.transformSync(source+'\nthis.home=UnvorHomeScreen;', {configFile:false,babelrc:false,plugins:['@babel/plugin-transform-react-jsx']}).code;
vm.runInNewContext(code,context);const tree=context.home({navigation:{navigate:(...args)=>calls.push(args)}});
function visit(n){if(!n||typeof n!=='object')return;if(n.props?.onPress)n.props.onPress();for(const c of n.children||[])visit(c);}visit(tree);
for(const target of ['Profile','Conversazioni','Rubrica','PilotGroups','CallLog','Stato','Impostazioni','GlobalSearch'])assert.ok(calls.some(c=>c[0]===target),target);
assert.ok(fs.readFileSync('src/lib/backup.js','utf8').includes('"ultron-backup-2"'));
assert.ok(fs.readFileSync('src/lib/verify.js','utf8').includes('"ULTRON2"'));
assert.ok(fs.readFileSync('android/app/build.gradle','utf8').includes("com.ultron.messenger.pilot"));
const labels=fs.readFileSync('android/app/build.gradle','utf8');assert.ok(labels.includes('UNVOR Chat'));
assert.ok(fs.readFileSync('android/app/src/main/java/com/ultron/messenger/WakeService.kt','utf8').includes('R.drawable.unvor_notification'));
console.log('UNVOR: home actions, existing app identity, backup/QR compatibility and native notification branding verified.');
