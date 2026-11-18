import { NativeModules } from "react-native";
import { authenticatedScope } from "./api";
import { bytesToHex, hexToBytes, randomHex, sha256Hex, utf8Encode } from "./crypto";
import { getBlob, setBlobsDurably } from "./lock";
import { createVolatileRelayConversation } from "./volatileRelayConversation";
import { createVolatileRelayMlsChannel } from "./volatileRelayMlsChannel";
import { createVolatileRelayOutbox } from "./volatileRelayOutbox";
import { createVolatileRelayTransport } from "./volatileRelayTransport";

export function configureVolatileRelay(user, registration, onState) {
  const checkAccount = authenticatedScope(user);
  const { origin, token, mailbox, installation, secretKey } = registration;
  if (typeof installation !== "string" || !/^[0-9a-f]{32}$/.test(installation) ||
      typeof secretKey !== "string" || !/^[0-9a-f]{8064}$/.test(secretKey)) {
    throw new Error("Chiave di installazione del relay non valida.");
  }
  const signer = NativeModules.UltronRelaySigner;
  if (typeof signer?.sign !== "function") throw new Error("Firma nativa del relay non disponibile.");
  let closed = false;
  const scope = () => {
    if (closed) throw new Error("Sessione relay chiusa.");
    checkAccount();
  };
  const signHex = async (transcript, context) => {
    scope();
    const signature = await signer.sign(bytesToHex(transcript), bytesToHex(context), secretKey);
    scope();
    if (typeof signature !== "string" || !/^[0-9a-f]{6618}$/.test(signature)) throw new Error("Firma del relay non valida.");
    return signature;
  };
  const transport = createVolatileRelayTransport({
    origin, token, sign: async (transcript, context) => hexToBytes(await signHex(transcript, context)),
  });
  const prefix = "relay-outbox:" + sha256Hex(JSON.stringify([user.server, user.lns, origin, installation, mailbox]));
  const vault = { read: getBlob, write: setBlobsDurably };
  const outbox = createVolatileRelayOutbox({
    prefix, sender: mailbox, vault, transport, scope, onState,
  });
  const signText = payload => signHex(utf8Encode(payload), new Uint8Array());
  return {
    outbox,
    admissionInfo: signal => { scope(); return transport.admissionInfo(signal); },
    async admit(grant, signal) {
      scope();
      const address = await transport.admit(grant, signal);
      scope();
      if (address !== mailbox) throw new Error("Indirizzo relay diverso da quello configurato.");
      return address;
    },
    conversation({ engine, pairing, mine, peer, receiveOnce }) {
      scope();
      if (mine.mailbox !== mailbox) throw new Error("Abbinamento locale diverso dal relay.");
      const channel = createVolatileRelayMlsChannel({
        engine, pairing, mine, peer, vault, scope, sign: signText,
        storageKey: prefix + ":mls:" + sha256Hex(JSON.stringify([pairing.id, pairing.epoch, peer.mailbox])),
      });
      return createVolatileRelayConversation({
        sender: mailbox, peer, transport, outbox, channel, receiveOnce, scope,
        randomId: () => randomHex(16),
        signReceipt: signText,
      });
    },
    close() {
      closed = true;
      outbox.close();
    },
  };
}
