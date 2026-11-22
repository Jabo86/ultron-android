import assert from "node:assert/strict";
import { createCipherUploader, postEncryptedBytes, setNativeBinaryUploader } from "../src/lib/binaryTransport.js";
const original = Uint8Array.from([99,0,1,2,255,5,88]);
const bytes = original.subarray(1,6);
const files = new Map();let request, code=200, fail=false, cancel;
const fs={cacheDirectory:"file:///private/",EncodingType:{Base64:"base64"},FileSystemUploadType:{BINARY_CONTENT:0},
 writeAsStringAsync:async(path,data)=>{files.set(path,Buffer.from(data,"base64"));},deleteAsync:async(path)=>{files.delete(path);},
 createUploadTask(url,path,options,progress){request={url,body:files.get(path),options};return{cancelAsync:async()=>{cancel?.();},uploadAsync:async()=>{if(fail)throw new Error("network failed");progress({totalBytesSent:5,totalBytesExpectedToSend:5});return{status:code,body:JSON.stringify({ok:true}),headers:{}};}};}};
const upload=createCipherUploader(fs,b=>Buffer.from(b).toString("base64"),()=>"synthetic");
const controller=new AbortController();let progress;
const result=await upload("https://synthetic.invalid/blob",bytes,{headers:{Authorization:"Bearer synthetic"},signal:controller.signal,onUploadProgress:p=>{progress=p;}});
assert.equal(result.data.ok,true);assert.deepEqual([...request.body],[0,1,2,255,5]);assert.equal(request.options.uploadType,0);assert.equal(request.options.headers.Authorization,"Bearer synthetic");assert.equal(progress.loaded,5);assert.equal(files.size,0);
code=401;await assert.rejects(upload("https://synthetic.invalid/blob",bytes),e=>e.response?.status===401);assert.equal(files.size,0);
code=200;fail=true;await assert.rejects(upload("https://synthetic.invalid/blob",bytes),/network failed/);assert.equal(files.size,0);
controller.abort();await assert.rejects(upload("https://synthetic.invalid/blob",bytes,{signal:controller.signal}),e=>e.name==="AbortError");assert.equal(files.size,0);
let selected=false;setNativeBinaryUploader(async(url,body)=>{selected=true;assert.equal(url,"https://synthetic.invalid/api/upload?i=1");assert.deepEqual(body,bytes);return{data:{ok:true}};});
await postEncryptedBytes({getUri:()=>"https://synthetic.invalid/api/upload?i=1"},"/upload",bytes,{params:{i:1}});assert.ok(selected);setNativeBinaryUploader(null);
console.log("Binary uploads: exact encrypted bytes, native path, progress, HTTP errors, abort-before-upload and temporary cleanup verified.");
