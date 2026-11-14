import AsyncStorage from "@react-native-async-storage/async-storage";
import { DEFAULT_SERVER } from "../config";
import * as api from "./api";
import { sha256Hex } from "./crypto";
import { signChatKeys, verifyChatKeys } from "./signedKeyProof";

export async function publishSignedChatKeys(owner, secret, kem, dh) {
  if (api.getServerUrl() !== DEFAULT_SERVER || !owner.endsWith("@ultron.uns")) return;
  const signature_hex = signChatKeys(owner, kem, dh, secret);
  try { await api.publishSignedKeys({ kem_pk_hex: kem, dh_pk_hex: dh, signature_hex }); }
  catch (error) { if (error?.response?.status !== 404) throw error; }
}

let pending = Promise.resolve();

export function hostedSignedChatKeys(owner, peer, validateKeys) {
  // Serialize first use so two simultaneous requests cannot pin conflicting identities.
  const operation = pending.then(async () => {
    const scope = `ultron.signed-identity:${sha256Hex(JSON.stringify([DEFAULT_SERVER, owner, peer]))}`;
    const pinned = await AsyncStorage.getItem(scope);
    let bundle;
    try { bundle = await api.signedKeys(peer); }
    catch (error) { if (error?.response?.status !== 404) throw error; }
    if (!bundle || bundle.signed === false) {
      if (pinned) throw new Error("Le chiavi firmate del contatto non sono più disponibili. Invio interrotto.");
      return null;
    }
    if (bundle.signed !== true || !verifyChatKeys(peer, bundle)) {
      throw new Error("Firma delle chiavi del contatto non valida. Invio interrotto.");
    }
    const identity = sha256Hex(bundle.identity_pk_hex);
    if (pinned && pinned !== identity) {
      throw new Error("La chiave d’identità del contatto è cambiata. Invio interrotto.");
    }
    validateKeys(bundle.kem_pk_hex, bundle.dh_pk_hex);
    if (!pinned) await AsyncStorage.setItem(scope, identity);
    return { kem: bundle.kem_pk_hex, dh: bundle.dh_pk_hex, identityKey: bundle.identity_pk_hex };
  });
  pending = operation.catch(() => {});
  return operation;
}
