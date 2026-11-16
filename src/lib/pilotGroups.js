import * as api from "./api";
import { decryptEnvelope, encryptForRecipients, randomHex, sha256Hex, signMessage, utf8Encode, verifyMessage } from "./crypto";
import { registerHostedRatchet, verifiedContact } from "./hostedRatchetChat";
import { hostedGroupCredentials } from "./hostedGroupCredentials";
import { getBlob, setBlobDurably } from "./lock";
import { createMlsGroupEngine } from "./mlsGroupEngine";
import { createMlsSubtleCrypto } from "./mlsMobileCrypto";

const queues = new Map();
const PACKAGE_LIFETIME = 86_400_000;
const PACKAGE_BATCH = 8;
const MAX_LOCAL_HISTORY = 200;
const validNumber = (n) => Number.isSafeInteger(n) && n >= 0;
const genesis = (server, id, admin) => JSON.stringify(["ultron-mls-group-v1", server, id, admin]);
const welcomeScope = (server, group, epoch, recipient, packageId, wire, invitation) =>
  JSON.stringify([invitation ? "ultron-mls-welcome-v2" : "ultron-mls-welcome-v1",
    server, group, epoch, recipient, packageId, sha256Hex(wire), ...(invitation ? [invitation] : [])]);
const listingScope = (server, id, admin, name) => JSON.stringify(["ultron-mls-listing-v1", server, id, admin, name]);
const consentScope = (server, group, invitation, inviter, target, decision) =>
  JSON.stringify(["ultron-mls-consent-v1", server, group, invitation, inviter, target, decision]);
const inviteTitleScope = (server, id, group, inviter, target, title) =>
  JSON.stringify(["ultron-mls-invite-title-v1", server, id, group, inviter, target, title]);
const messageScope = (id, epoch, op, author, type, body) => JSON.stringify(["ultron-mls-message-v1", id, epoch, op, author, type, body]);
const blob = (user, name) => "mls:" + sha256Hex(JSON.stringify([user.server, user.lns, name]));

let dependency;
function loadMls() {
  if (!dependency) {
    if (!globalThis.crypto?.getRandomValues) throw new Error("Generatore sicuro Android non disponibile.");
    if (!globalThis.crypto.subtle) Object.defineProperty(globalThis.crypto, "subtle", { value: createMlsSubtleCrypto() });
    dependency = import("fast-text-encoding").then(() => Promise.all([import("ts-mls"), import("ts-mls/clientConfig.js")]));
  }
  return dependency;
}

function serial(user, job) {
  const key = blob(user, "queue");
  const previous = queues.get(key) || Promise.resolve();
  const task = previous.catch(() => {}).then(job);
  queues.set(key, task);
  return task.finally(() => { if (queues.get(key) === task) queues.delete(key); });
}

async function context(user) {
  const check = api.authenticatedScope(user);
  const credentials = await hostedGroupCredentials(user);
  const [mls, { defaultClientConfig }] = await loadMls();
  const engine = await createMlsGroupEngine(mls, defaultClientConfig, credentials);
  check();
  return { check, credentials, engine };
}

function expectGroup(row) {
  if (!/^[0-9a-f]{64}$/.test(row?.id || "") || !/^[0-9a-f]{6618}$/.test(row.signature || "") ||
      !validNumber(row.seq) || !validNumber(row.epoch) || !validNumber(row.since) || row.seq < row.since) {
    throw new Error("Elenco gruppi non valido.");
  }
  return row;
}

export async function listPilotGroups() {
  const rows = await api.mlsGroups();
  if (!Array.isArray(rows)) throw new Error("Elenco gruppi non disponibile.");
  return rows.map(expectGroup);
}

function expectInvitation(row) {
  if (!/^[a-f0-9]{32}$/.test(row?.id || "") || !/^[a-f0-9]{64}$/.test(row.group || "") ||
      !/^[a-z0-9._-]+@ultron\.uns$/.test(row.target || "") || !/^[a-z0-9._-]+@ultron\.uns$/.test(row.inviter || "") ||
      !["pending", "accepted", "declined"].includes(row.status)) throw new Error("Invito al gruppo non valido.");
  return row;
}

export async function listPublicPilotGroups(user) {
  const check = api.authenticatedScope(user);
  const rows = await api.mlsPublicGroups();
  check();
  if (!Array.isArray(rows)) throw new Error("Elenco pubblico non disponibile.");
  return rows.filter(row => /^[a-f0-9]{64}$/.test(row?.id || "") && /^[a-z0-9._-]+@ultron\.uns$/.test(row.admin || "") &&
    typeof row.name === "string" && row.name.length > 0 && [...row.name].length <= 60);
}

export async function pilotInvitationInbox(user) {
  const check = api.authenticatedScope(user);
  const rows = await api.mlsInvitations();
  check();
  if (!Array.isArray(rows)) throw new Error("Inviti non disponibili.");
  return rows.map(expectInvitation).filter(row => row.target === user.lns);
}

export async function pilotInvitationTitle(user, invitation) {
  if (typeof invitation.note !== "string" || invitation.note.length > 32768) return null;
  try {
    const plain = decryptEnvelope(JSON.parse(invitation.note), user.kem.secretKey);
    const { title, signature } = JSON.parse(plain);
    if (typeof title !== "string" || !title || title.length > 60) return null;
    const credentials = await hostedGroupCredentials(user);
    const key = await credentials.identityFor(invitation.inviter);
    const scope = inviteTitleScope(user.server, invitation.id, invitation.group, invitation.inviter, invitation.target, title);
    return verifyMessage(scope, signature, key) ? title : null;
  } catch { return null; }
}

export async function pilotGroupInvitations(user, group) {
  const check = api.authenticatedScope(user);
  const rows = await api.mlsGroupInvitations(group.id);
  check();
  if (!Array.isArray(rows)) throw new Error("Inviti non disponibili.");
  return rows.map(expectInvitation).filter(row => row.group === group.id && row.inviter === user.lns);
}

export async function requestPilotGroupInvitation(user, group, target) {
  const check = api.authenticatedScope(user);
  if (group.admin !== user.lns) throw new Error("Solo l’amministratore può inviare inviti.");
  const credentials = await hostedGroupCredentials(user);
  if (!await credentials.identityFor(target)) throw new Error("Verifica il QR ULTRON del contatto.");
  check();
  const id = randomHex(16);
  const title = await cachedPilotGroupTitle(user, group);
  const key = await verifiedContact(user, target);
  const signature = title ? signMessage(inviteTitleScope(user.server, id, group.id, user.lns, target, title), user.sk) : null;
  const note = title ? JSON.stringify(encryptForRecipients(JSON.stringify({ title, signature }), { [target]: key.kem })[0]) : undefined;
  check();
  const answer = expectInvitation(await api.mlsRequestInvitation(group.id, { id, target, note }));
  check();
  if (answer.group !== group.id || answer.target !== target || answer.inviter !== user.lns) {
    throw new Error("Il gateway non ha confermato l’invito.");
  }
  return answer;
}

export async function decidePilotGroupInvitation(user, row, decision) {
  const check = api.authenticatedScope(user);
  expectInvitation(row);
  if (row.target !== user.lns || !["accepted", "declined"].includes(decision)) throw new Error("Decisione non valida.");
  if (decision === "accepted") {
    const credentials = await hostedGroupCredentials(user);
    if (!await credentials.identityFor(row.inviter)) throw new Error("Verifica prima il QR ULTRON di chi ti ha invitato.");
    await preparePilotGroupInvites(user);
  }
  return serial(user, async () => {
    check();
    const transcript = consentScope(user.server, row.group, row.id, row.inviter, row.target, decision);
    const signature = signMessage(transcript, user.sk);
    // Store the user's explicit decision before transmission so a lost reply
    // doesn't remove their ability to open the resulting Welcome.
    await setBlobDurably(blob(user, "invite:" + row.id), { group: row.group, inviter: row.inviter, decision });
    check();
    const answer = expectInvitation(await api.mlsDecideInvitation(row.id, { decision, signature }));
    check();
    if (answer.id !== row.id || answer.status !== decision) throw new Error("Decisione non confermata dal gateway.");
    return answer;
  });
}

export function preparePilotGroupInvites(user) {
  return serial(user, async () => {
    const check = api.authenticatedScope(user);
    await registerHostedRatchet(user);
    check();
    const key = blob(user, "packages");
    let pool = await getBlob(key) || [];
    const now = Date.now();
    if (pool.filter(item => item.id && !item.used && now - item.at < PACKAGE_LIFETIME / 2).length >= 4) return;
    const { engine } = await context(user);
    // Previously consumed keys are removed when Welcome is saved; preserve an
    // old private package for a bounded time so offline invites can be opened.
    pool = pool.filter(item => now - item.at < 7 * PACKAGE_LIFETIME && !item.used);
    const fresh = pool.filter(item => now - item.at < PACKAGE_LIFETIME / 2);
    while (fresh.length < PACKAGE_BATCH) {
      const next = { ...await engine.createKeyPackage(), at: now };
      fresh.push(next); pool.push(next);
    }
    check();
    await setBlobDurably(key, pool);
    for (const item of fresh) {
      if (item.id) continue;
      check();
      const result = await api.mlsPublishPackage(item.wire);
      if (!/^[a-f0-9]{64}$/.test(result?.id || "")) throw new Error("Pubblicazione MLS non confermata.");
      item.id = result.id;
      check();
      await setBlobDurably(key, pool);
    }
  });
}

async function assertDescriptor(user, row, credentials) {
  expectGroup(row);
  const key = await credentials.identityFor(row.admin);
  if (!key || !verifyMessage(genesis(user.server, row.id, row.admin), row.signature, key)) {
    throw new Error("Verifica il nuovo QR dell’amministratore prima di accedere al gruppo.");
  }
}

async function flush(user, id, record, check) {
  const pending = record.pending;
  if (!pending) return record;
  const key = blob(user, id);
  check();
  let ack;
  try {
    ack = await api.mlsAppend(id, pending.body);
  } catch (error) {
    // The gateway checks the operation id before the current cursor. A 409
    // confirms this exact reservation did not commit on this group.
    if (error?.response?.status === 409) {
      check();
      await setBlobDurably(key, { ...record, pending: null });
    }
    throw error;
  }
  check();
  if (ack?.seq !== record.cursor + 1 || ack.epoch !== record.epoch + (pending.body.kind === "message" ? 0 : 1)) {
    throw new Error("Conferma MLS non valida.");
  }
  const updated = { ...record, epoch: ack.epoch, cursor: ack.seq, state: pending.snapshot, pending: null, lastAt: new Date().toISOString() };
  if (pending.type === "title") updated.title = pending.text;
  else if (pending.body.kind === "message") {
    updated.history = [...record.history, { seq: ack.seq, sender: user.lns, body: pending.text }].slice(-MAX_LOCAL_HISTORY);
  }
  await setBlobDurably(key, updated);
  return updated;
}

async function sync(user, row, ctx) {
  const { engine, check, credentials } = ctx;
  const { id } = row;
  await assertDescriptor(user, row, credentials);
  const key = blob(user, id);
  let record = await getBlob(key);
  if (record && record.since < row.since) record = null;
  if (!record && row.since === 0) throw new Error("Le chiavi di questo gruppo sono su un’altra installazione.");
  if (record) record = await flush(user, id, record, check);
  for (let batch = 0; batch < 32; batch++) {
    check();
    const page = await api.mlsEvents(id, record?.cursor ?? row.since - 1);
    if (!Array.isArray(page?.events) || !validNumber(page.seq) || page.since !== row.since ||
        (record && page.seq < record.cursor)) throw new Error("Sequenza del gateway non valida.");
    for (const event of page.events) {
      if (!record) {
        if (event.seq !== row.since || event.kind !== "add" || event.subject !== user.lns || event.author !== row.admin ||
            !event.welcome || !validNumber(event.epoch) || event.next_epoch !== event.epoch + 1) {
          throw new Error("Invito MLS incompleto.");
        }
        const adminKey = await credentials.identityFor(row.admin);
        const proof = welcomeScope(user.server, id, event.next_epoch, user.lns, event.package, event.welcome, event.invitation);
        if (!/^[a-f0-9]{6618}$/.test(event.welcome_signature || "") || !/^[a-f0-9]{64}$/.test(event.package || "") ||
            !verifyMessage(proof, event.welcome_signature, adminKey)) throw new Error("Firma dell’invito di gruppo non valida.");
        if (event.invitation || event.consent) {
          const marker = await getBlob(blob(user, "invite:" + event.invitation));
          const consent = consentScope(user.server, id, event.invitation, row.admin, user.lns, "accepted");
          if (!marker || marker.group !== id || marker.inviter !== row.admin || marker.decision !== "accepted" ||
              !verifyMessage(consent, event.consent, user.pk)) throw new Error("L’invito richiede il tuo consenso.");
        }
        const poolKey = blob(user, "packages");
        const pool = await getBlob(poolKey) || [];
        const found = pool.find(item => item.id === event.package);
        if (!found) throw new Error("La chiave monouso per l’invito non è su questo telefono.");
        const state = await engine.join(id, event.next_epoch, event.welcome, found, row.admin);
        record = { since: row.since, state, epoch: event.next_epoch, cursor: event.seq, history: [], pending: null };
        check();
        await setBlobDurably(key, record);
        check();
        await setBlobDurably(poolKey, pool.filter(item => item.id !== found.id));
        continue;
      }

      if (event.seq !== record.cursor + 1) throw new Error("Mancano eventi nella chat di gruppo.");
      const decoded = await engine.receive(record.state, id, record.epoch, event, row.admin);
      let history = record.history, title = record.title;
      if (decoded.payload !== null) {
        const { body, signature, type } = JSON.parse(decoded.payload);
        const author = await credentials.identityFor(event.author);
        if (typeof body !== "string" || !["text", "title"].includes(type) ||
            (type === "title" ? event.author !== row.admin || !body || body.length > 60 : body.length > 2000) || !/^[a-f0-9]{6618}$/.test(signature || "") ||
            !engine.members(record.state, id, record.epoch).includes(event.author) || !author ||
            !verifyMessage(messageScope(id, record.epoch, event.op, event.author, type, body), signature, author)) {
          throw new Error("Firma del messaggio di gruppo non valida.");
        }
        if (type === "title") title = body;
        else history = [...history, { seq: event.seq, sender: event.author, body }].slice(-MAX_LOCAL_HISTORY);
      }
      record = { ...record, cursor: event.seq, epoch: decoded.epoch, state: decoded.snapshot, history, title, lastAt: new Date().toISOString() };
      check();
      await setBlobDurably(key, record);
    }
    if (record?.cursor === page.seq) return record;
    if (!page.events.length) break;
  }
  throw new Error("La cronologia del gruppo è ancora in sincronizzazione.");
}

export function createPilotGroup(user, name, visibility = "private") {
  return serial(user, async () => {
    const { engine, check } = await context(user);
    const draft = blob(user, "create");
    let pending = await getBlob(draft);
    if (!pending) {
      const id = randomHex(32);
      const state = await engine.create(id);
      const signature = signMessage(genesis(user.server, id, user.lns), user.sk);
      const title = name?.trim() || undefined;
      const listing = visibility === "public" && title ? { name: title,
        signature: signMessage(listingScope(user.server, id, user.lns, title), user.sk) } : undefined;
      pending = { id, signature, state, title, listing };
      check();
      await setBlobDurably(draft, pending);
    }
    const { id, state, signature, title, listing } = pending;
    check();
    const groupKey = blob(user, id);
    if (!await getBlob(groupKey)) {
      check();
      await setBlobDurably(groupKey, { since: 0, cursor: 0, epoch: 0, history: [], state, pending: null, title, lastAt: new Date().toISOString() });
    }
    check();
    const res = await api.mlsCreate({ id, signature, listing });
    if (res?.id !== id) throw new Error("Creazione gruppo non confermata.");
    check();
    await setBlobDurably(draft, null);
    return { id, admin: user.lns, signature, since: 0, seq: 0, epoch: 0, title };
  });
}

export function openPilotGroup(user, row) {
  return serial(user, async () => {
    const ctx = await context(user);
    const record = await sync(user, row, ctx);
    return { title: record.title, history: record.history, members: ctx.engine.members(record.state, row.id, record.epoch) };
  });
}

export function updatePilotGroup(user, row, kind, value, invitation) {
  return serial(user, async () => {
    const ctx = await context(user);
    const { engine, check, credentials } = ctx;
    const record = await sync(user, row, ctx);
    const { id } = row;
    const body = { op: randomHex(16), cursor: record.cursor, epoch: record.epoch, kind: kind === "title" ? "message" : kind };
    let update;
    let text, type;
    if (kind === "message" || kind === "title") {
      type = kind === "title" ? "title" : "text";
      text = value.trim();
      if (!text || (type === "title" ? text.length > 60 || row.admin !== user.lns : text.length > 2000) || utf8Encode(text).length > 8000) throw new Error("Messaggio di gruppo non valido.");
      const signature = signMessage(messageScope(id, record.epoch, body.op, user.lns, type, text), user.sk);
      update = await engine.send(record.state, id, record.epoch, JSON.stringify({ body: text, signature, type }));
    } else if (kind === "add" || kind === "remove") {
      if (row.admin !== user.lns) throw new Error("Solo l’amministratore può modificare i membri.");
      body.target = value.trim().toLowerCase();
      let keyPackage;
      if (kind === "add") {
        const members = engine.members(record.state, id, record.epoch);
        if (members.includes(body.target)) return { title: record.title, history: record.history, members };
        const identity = await credentials.identityFor(body.target);
        if (!identity) throw new Error("Per questo contatto manca l’impronta della firma nel QR ULTRON.");
        if (invitation) {
          expectInvitation(invitation);
          const consent = consentScope(user.server, id, invitation.id, user.lns, body.target, "accepted");
          if (invitation.group !== id || invitation.inviter !== user.lns || invitation.target !== body.target ||
              invitation.status !== "accepted" || !verifyMessage(consent, invitation.proof, identity)) {
            throw new Error("Consenso del destinatario non verificato.");
          }
          body.invitation = invitation.id;
        }
        const claim = await api.mlsClaimPackage(body.target, body.op);
        if (!/^[0-9a-f]{64}$/.test(claim?.id || "")) throw new Error("Pacchetto MLS non disponibile.");
        body.package = claim.id;
        keyPackage = claim.wire;
      }
      update = await engine.change(record.state, id, record.epoch, kind, body.target, keyPackage);
      if (kind === "add") {
        if (!update.welcome) throw new Error("Invito MLS non generato.");
        body.welcome = update.welcome;
        body.welcome_signature = signMessage(welcomeScope(user.server, id, record.epoch + 1, body.target, body.package, body.welcome, body.invitation), user.sk);
      }
    } else throw new Error("Operazione gruppo non valida.");

    const pending = { body: { ...body, wire: update.wire }, snapshot: update.snapshot, text, type };
    const staged = { ...record, pending };
    check();
    await setBlobDurably(blob(user, id), staged);
    const completed = await flush(user, id, staged, check);
    return { title: completed.title, history: completed.history, members: engine.members(completed.state, id, completed.epoch) };
  });
}


export async function cachedPilotGroupSummary(user, row) {
  const record = await getBlob(blob(user, row.id));
  return record?.since === row.since ? { title: record.title, lastAt: record.lastAt } : {};
}

export async function cachedPilotGroupTitle(user, row) {
  return (await cachedPilotGroupSummary(user, row)).title || null;
}
