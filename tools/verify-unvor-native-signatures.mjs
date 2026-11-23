import assert from 'node:assert/strict';import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {execFileSync} from 'node:child_process';
import {keygen,signMessage,verifyMessage,hexToBytes} from '../src/lib/crypto.js';
const root=mkdtempSync(join(tmpdir(),'unvor-mldsa-')),message='ultron-ratchet-init-v1\nSynthetic cross-implementation transcript';
try{
 const keys=keygen();assert.equal(keys.secretKeyHex.length,8064);
 writeFileSync(join(root,'secret'),hexToBytes(keys.secretKeyHex),{mode:0o600});writeFileSync(join(root,'public'),hexToBytes(keys.publicKeyHex));writeFileSync(join(root,'message'),message);writeFileSync(join(root,'js-signature'),hexToBytes(signMessage(message,keys.secretKeyHex)));
 execFileSync('java',['--class-path',process.env.UNVOR_BCPROV_JAR||'/tmp/unvor-bcprov.jar','tools/UnvorMldsaInterop.java',root],{stdio:'inherit'});
 const signature=readFileSync(join(root,'native-signature')).toString('hex');assert.equal(signature.length,6618);assert.equal(verifyMessage(message,signature,keys.publicKeyHex),true);assert.equal(verifyMessage(message+'changed',signature,keys.publicKeyHex),false);
 console.log('ML-DSA-65: native/JavaScript signatures cross-verified, tampered transcript rejected.');
}finally{rmSync(root,{recursive:true,force:true});}
