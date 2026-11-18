import { relayPacketDigest, relayReceiptPayload } from "./volatileRelayTransport.js";

const idPattern = /^[a-f0-9]{32}$/;

// The channel must apply the verified end-to-end session in both directions.
// receiveOnce must commit/deduplicate by sender and ID before returning.
export function createVolatileRelayConversation({
  sender, peer, transport, outbox, channel, receiveOnce, signReceipt, randomId, scope,
}) {
  if (!idPattern.test(sender) || !idPattern.test(peer?.mailbox) || sender === peer.mailbox ||
      typeof channel?.seal !== "function" || typeof channel?.open !== "function" ||
      typeof receiveOnce !== "function") throw new Error("Conversazione relay non valida.");

  const aborter = new AbortController();
  let polling;
  const guarded = () => {
    if (aborter.signal.aborted) throw new Error("Conversazione relay chiusa.");
    scope();
  };

  async function drain() {
    guarded();
    const { messages } = await transport.inbox(aborter.signal);
    guarded();
    if (!Array.isArray(messages)) throw new Error("Risposta relay non valida.");
    for (const packet of messages) {
      if (packet.sender !== peer.mailbox || !idPattern.test(packet.message_id)) continue;
      const digest = relayPacketDigest(packet.ciphertext);
      const opened = await channel.open(packet.ciphertext);
      guarded();
      if (opened.sender !== peer.mailbox || opened.recipient !== sender ||
          opened.id !== packet.message_id) throw new Error("Identità della busta relay non valida.");

      if (opened.kind === "message") {
        if (typeof opened.payload !== "string") throw new Error("Messaggio relay non valido.");
        await receiveOnce({ sender: peer.mailbox, id: opened.id, payload: opened.payload });
        guarded();
        const signature = await signReceipt(relayReceiptPayload(peer.mailbox, sender, opened.id, digest));
        guarded();
        const receiptId = randomId();
        const ciphertext = await channel.seal({
          kind: "receipt", id: receiptId, sender, recipient: peer.mailbox,
          messageId: opened.id, signature,
        });
        guarded();
        // Only remove the incoming packet after the receipt has reached the relay.
        // After a relay restart the sender retries the original ID and we resend
        // the receipt even if receiveOnce has already stored that message.
        await transport.send({ id: receiptId, recipient: peer.mailbox, ciphertext }, aborter.signal);
      } else if (opened.kind === "receipt") {
        if (!idPattern.test(opened.messageId) || typeof opened.signature !== "string") {
          throw new Error("Ricevuta relay non valida.");
        }
        await outbox.acceptReceipt(opened.messageId, opened.signature);
      } else {
        throw new Error("Busta del relay non riconosciuta.");
      }
      guarded();
      await transport.acknowledge({ sender: packet.sender, id: packet.message_id }, aborter.signal);
    }
  }

  return {
    async send(id, payload) {
      guarded();
      if (!idPattern.test(id) || typeof payload !== "string") throw new Error("Messaggio relay non valido.");
      const ciphertext = await channel.seal({ kind: "message", id, sender, recipient: peer.mailbox, payload });
      guarded();
      return outbox.enqueue({ id, recipient: peer.mailbox, recipientKey: peer.publicKey, ciphertext });
    },
    poll() {
      if (!polling) polling = drain().finally(() => { polling = undefined; });
      return polling;
    },
    close() { aborter.abort(); },
  };
}
