import { sha256Hex, verifyMessage } from "./crypto.js";

const limit = 128;
const validId = value => typeof value === "string" && /^[0-9a-f]{32}$/.test(value);

// The two snapshots are paired out of band with verified MLS credentials.
// The relay cannot supply a credential, session state or signing key here.
export function createVolatileRelayMlsChannel({ engine, vault, storageKey, pairing, mine, peer, sign, scope }) {
  const { id, epoch, founder, snapshot } = pairing;
  if (!/^[0-9a-f]{64}$/.test(id) || !Number.isSafeInteger(epoch) || epoch < 1 ||
      typeof snapshot !== "string" || snapshot.length > 524288 || mine.account === peer.account ||
      ![mine.account, peer.account].includes(founder)) throw new Error("Abbinamento MLS non valido.");
  const members = engine.members(snapshot, id, epoch);
  if (members.length !== 2 || !members.includes(mine.account) || !members.includes(peer.account)) {
    throw new Error("Il canale MLS deve avere esattamente due dispositivi verificati.");
  }
  const transcript = payload => JSON.stringify(["ultron-private-relay-mls-v1", id, epoch, sha256Hex(payload)]);
  let queue = Promise.resolve();
  const serial = fn => {
    const operation = queue.then(async () => {
      scope();
      const state = await vault.read(storageKey) ?? { snapshot, outbound: [], inbound: [] };
      scope();
      return fn(state);
    });
    queue = operation.catch(() => {});
    return operation;
  };

  return {
    seal(packet) {
      return serial(async state => {
        if (packet?.sender !== mine.mailbox || packet.recipient !== peer.mailbox || !validId(packet.id)) {
          throw new Error("Mittente relay non valido.");
        }
        const payload = JSON.stringify(packet);
        const digest = sha256Hex(payload);
        const previous = state.outbound.find(row => row.id === packet.id);
        if (previous) {
          if (previous.digest !== digest) throw new Error("Identificativo MLS già usato.");
          return previous.wire;
        }
        const signature = await sign(transcript(payload));
        scope();
        const next = await engine.send(state.snapshot, id, epoch, JSON.stringify({ payload, signature }));
        scope();
        await vault.write([[storageKey, { ...state, snapshot: next.snapshot,
          outbound: [...state.outbound, { id: packet.id, digest, wire: next.wire }].slice(-limit) }]]);
        scope();
        return next.wire;
      });
    },

    open(wire, expectedId) {
      return serial(async state => {
        if (!validId(expectedId)) throw new Error("Identificativo MLS mancante.");
        const digest = sha256Hex(wire);
        const remembered = state.inbound.find(row => row.id === expectedId);
        if (remembered) {
          if (remembered.digest !== digest) throw new Error("Busta MLS diversa per lo stesso messaggio.");
          return remembered.packet;
        }
        const next = await engine.receive(state.snapshot, id, epoch, {
          kind: "message", epoch, next_epoch: epoch, wire, author: peer.account,
        }, founder);
        const { payload, signature } = JSON.parse(next.payload);
        if (typeof payload !== "string" || !/^[0-9a-f]{6618}$/.test(signature) ||
            !verifyMessage(transcript(payload), signature, peer.publicKey)) {
          throw new Error("Firma del contatto MLS non valida.");
        }
        const packet = JSON.parse(payload);
        if (packet?.sender !== peer.mailbox || packet.recipient !== mine.mailbox || packet.id !== expectedId) {
          throw new Error("Partecipanti MLS diversi dall’abbinamento.");
        }
        scope();
        await vault.write([[storageKey, { ...state, snapshot: next.snapshot,
          inbound: [...state.inbound, { id: expectedId, digest, packet }].slice(-limit) }]]);
        scope();
        return packet;
      });
    },
  };
}
