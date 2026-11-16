import { base64ToBytes, bytesToBase64, bytesToHex, hexToBytes, utf8Decode, utf8Encode } from "./crypto.js";
import { GROUP_CIPHERSUITE, readGroupCredential } from "./groupMemberProof.js";

function decodeComplete(decoder, bytes) {
  const result = decoder(bytes, 0);
  if (!result || result[1] !== bytes.length) throw new Error("Busta MLS non valida.");
  return result[0];
}

function leafAccount(leaf) {
  return readGroupCredential(leaf?.credential?.identity)?.account;
}

function checkSender(tree, leafIndex, account) {
  const leaf = tree[typeof leafIndex === "number" ? leafIndex * 2 : -1]?.leaf;
  return leafAccount(leaf) === account;
}

function checkProposal(tree, incoming, event, admin) {
  if (incoming.kind !== "commit" || !checkSender(tree, incoming.senderLeafIndex, admin) ||
      event.author !== admin || incoming.proposals.length !== 1) return "reject";
  const [item] = incoming.proposals;
  const proposal = item.proposal;
  if (event.kind === "add" && proposal.proposalType === "add" &&
      leafAccount(proposal.add.keyPackage.leafNode) === event.subject) return "accept";
  if (event.kind === "remove" && proposal.proposalType === "remove" &&
      checkSender(tree, proposal.remove.removed, event.subject)) return "accept";
  return "reject";
}

function assertGroup(state, id, epoch) {
  if (!Number.isSafeInteger(epoch) || epoch < 0 || bytesToHex(state.groupContext.groupId) !== id ||
      state.groupContext.epoch !== BigInt(epoch) || state.groupActiveState.kind !== "active") {
    throw new Error("Identità o generazione MLS non valida.");
  }
}

const privateFields = ["initPrivateKey", "hpkePrivateKey", "signaturePrivateKey"];

export async function createMlsGroupEngine(mls, defaultConfig, credentials) {
  const cipher = await mls.getCiphersuiteImpl(mls.getCiphersuiteFromName(GROUP_CIPHERSUITE));
  const config = { ...defaultConfig, authService: credentials.authService,
    keyRetentionConfig: { ...defaultConfig.keyRetentionConfig, retainKeysForEpochs: 0, retainKeysForGenerations: 0 } };
  const pack = message => bytesToBase64(mls.encodeMlsMessage(message));
  const unpack = wire => decodeComplete(mls.decodeMlsMessage, base64ToBytes(wire));
  const save = state => bytesToBase64(mls.encodeGroupState(state));
  const restore = (state, id, epoch) => {
    const client = { ...decodeComplete(mls.decodeGroupState, base64ToBytes(state)), clientConfig: config };
    assertGroup(client, id, epoch);
    return client;
  };

  async function makePackage() {
    const pair = await cipher.signature.keygen();
    return mls.generateKeyPackageWithKey(credentials.createCredential(pair.publicKey),
      mls.defaultCapabilities(), mls.defaultLifetime, [], pair, cipher);
  }

  function cleanup(result) {
    result.consumed.forEach(mls.zeroOutUint8Array);
  }

  function packageFrom(wire) {
    const message = unpack(wire);
    if (message.wireformat !== "mls_key_package" || message.keyPackage.cipherSuite !== GROUP_CIPHERSUITE) {
      throw new Error("Pacchetto chiave MLS non valido.");
    }
    return message.keyPackage;
  }

  return {
    async create(id) {
      const pair = await makePackage();
      const state = await mls.createGroup(hexToBytes(id), pair.publicPackage, pair.privatePackage, [], cipher, config);
      assertGroup(state, id, 0);
      return save(state);
    },
    async createKeyPackage() {
      const pair = await makePackage();
      const wire = pack({ version: "mls10", wireformat: "mls_key_package", keyPackage: pair.publicPackage });
      return { wire, private: Object.fromEntries(privateFields.map(field => [field, bytesToBase64(pair.privatePackage[field])])) };
    },
    async join(id, epoch, welcome, packageRecord, admin) {
      const message = unpack(welcome);
      if (message.wireformat !== "mls_welcome") throw new Error("Invito MLS non valido.");
      const privateKeys = Object.fromEntries(privateFields.map(field => [field, base64ToBytes(packageRecord.private[field])]));
      const state = await mls.joinGroup(message.welcome, packageFrom(packageRecord.wire), privateKeys,
        mls.emptyPskIndex, cipher, undefined, undefined, config);
      assertGroup(state, id, epoch);
      if (!state.ratchetTree.some(node => leafAccount(node?.leaf) === admin)) throw new Error("Amministratore MLS assente.");
      return save(state);
    },
    async change(state, id, epoch, kind, target, keyPackageWire) {
      const client = restore(state, id, epoch);
      let extra;
      if (kind === "add") {
        const keyPackage = packageFrom(keyPackageWire);
        if (leafAccount(keyPackage.leafNode) !== target) throw new Error("Il pacchetto non appartiene al contatto.");
        extra = { proposalType: "add", add: { keyPackage } };
      } else if (kind === "remove") {
        const index = client.ratchetTree.findIndex(node => leafAccount(node?.leaf) === target);
        if (index < 0 || index % 2 !== 0) throw new Error("Membro MLS non trovato.");
        extra = { proposalType: "remove", remove: { removed: index / 2 } };
      } else throw new Error("Modifica MLS non valida.");
      const result = await mls.createCommit({ state: client, cipherSuite: cipher }, {
        extraProposals: [extra], ratchetTreeExtension: true,
      });
      assertGroup(result.newState, id, epoch + 1);
      const snapshot = save(result.newState);
      cleanup(result);
      return { snapshot, wire: pack(result.commit),
        welcome: result.welcome ? pack({ version: "mls10", wireformat: "mls_welcome", welcome: result.welcome }) : undefined };
    },
    async send(state, id, epoch, payload) {
      const result = await mls.createApplicationMessage(restore(state, id, epoch), utf8Encode(payload), cipher);
      const snapshot = save(result.newState);
      cleanup(result);
      return { snapshot: snapshot, wire: pack({ version: "mls10", wireformat: "mls_private_message", privateMessage: result.privateMessage }) };
    },
    async receive(state, id, epoch, event, admin) {
      if (event.epoch !== epoch) throw new Error("Sequenza MLS non valida.");
      const client = restore(state, id, epoch);
      const message = unpack(event.wire);
      const authorise = (incoming) => checkProposal(client.ratchetTree, incoming, event, admin);
      let result;
      if (message.wireformat === "mls_private_message") {
        result = await mls.processPrivateMessage(client, message.privateMessage, mls.emptyPskIndex, cipher, authorise);
      } else if (message.wireformat === "mls_public_message" && event.kind !== "message") {
        result = await mls.processPublicMessage(client, message.publicMessage, mls.emptyPskIndex, cipher, authorise);
      } else throw new Error("Formato MLS non valido.");
      const isMessage = result.kind === "applicationMessage";
      if (event.kind === "message" ? !isMessage : isMessage || result.actionTaken !== "accept") {
        throw new Error("Azione MLS non autorizzata.");
      }
      const expectedEpoch = epoch + (isMessage ? 0 : 1);
      if (event.next_epoch !== expectedEpoch) throw new Error("Generazione MLS non valida.");
      assertGroup(result.newState, id, expectedEpoch);
      const snapshot = save(result.newState);
      const payload = isMessage ? utf8Decode(result.message) : null;
      cleanup(result);
      return { snapshot, payload, epoch: expectedEpoch };
    },
    members(state, id, epoch) {
      return restore(state, id, epoch).ratchetTree.map(node => leafAccount(node?.leaf)).filter(Boolean);
    },
  };
}
