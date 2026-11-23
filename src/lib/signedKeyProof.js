import { signMessage, verifyMessage, verifyMessageAsync } from "./crypto.js";

export function chatKeyMessage(owner, kem, dh) {
  return `ultron-chat-keys-v1\n${owner.toLowerCase()}\n${kem}\n${dh}`;
}

export function signChatKeys(owner, kem, dh, secret) {
  return signMessage(chatKeyMessage(owner, kem, dh), secret);
}

export function verifyChatKeys(owner, bundle) {
  const { kem_pk_hex: kem, dh_pk_hex: dh, identity_pk_hex: identity, signature_hex: signature } = bundle;
  const hex = (value, len) => typeof value === "string" && value.length === len && /^[0-9a-f]+$/.test(value);
  return hex(kem, 2368) && hex(dh, 64) && hex(identity, 3904) && hex(signature, 6618) &&
    verifyMessage(chatKeyMessage(owner, kem, dh), signature, identity);
}

export async function verifyChatKeysAsync(owner,bundle){
 const {kem_pk_hex:kem,dh_pk_hex:dh,identity_pk_hex:identity,signature_hex:signature}=bundle;
 const hex=(value,len)=>typeof value==='string'&&value.length===len&&/^[0-9a-f]+$/.test(value);
 return hex(kem,2368)&&hex(dh,64)&&hex(identity,3904)&&hex(signature,6618)&&await verifyMessageAsync(chatKeyMessage(owner,kem,dh),signature,identity);
}
