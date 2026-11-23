import assert from 'node:assert/strict';
import {randomBytes,createCipheriv,createDecipheriv} from 'node:crypto';
import {bytesToBase64,base64ToBytes,attachmentAes,setNativeAttachmentCipher} from '../src/lib/crypto.js';
for(const length of [0,1,2,3,12287,12288,12289,500*1024,4*1024*1024+16]) {
 const bytes=randomBytes(length), encoded=bytesToBase64(bytes);
 assert.equal(encoded,bytes.toString('base64'));assert.deepEqual(Buffer.from(base64ToBytes(encoded)),bytes);
}
const key=randomBytes(32),iv=randomBytes(12),plain=randomBytes(500*1024);
const expected=await attachmentAes(plain,key,iv,true);let calls=0;
setNativeAttachmentCipher(async(data,keyHex,ivHex,encrypt)=>{
 calls++;await new Promise(resolve=>setImmediate(resolve));
 const k=Buffer.from(keyHex,'hex'),nonce=Buffer.from(ivHex,'hex'),input=Buffer.from(data,'base64');
 if(encrypt){const aes=createCipheriv('aes-256-gcm',k,nonce);return Buffer.concat([aes.update(input),aes.final(),aes.getAuthTag()]).toString('base64');}
 const aes=createDecipheriv('aes-256-gcm',k,nonce);aes.setAuthTag(input.subarray(-16));return Buffer.concat([aes.update(input.subarray(0,-16)),aes.final()]).toString('base64');
});
const encrypted=await attachmentAes(plain,key,iv,true);assert.deepEqual(encrypted,expected);
assert.deepEqual(Buffer.from(await attachmentAes(encrypted,key,iv,false)),plain);
const changed=encrypted.slice();changed[0]^=1;await assert.rejects(attachmentAes(changed,key,iv,false));assert.equal(calls,3);
setNativeAttachmentCipher(null);
console.log('Attachment worker bridge: base64 boundaries, 4MiB frame, exact AES-GCM wire parity, authenticated decrypt and tamper rejection passed.');
