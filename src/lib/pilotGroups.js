import { MAX_ATTACHMENT_BYTES, ATTACHMENT_CHUNK_BYTES } from "./attachmentLimits";
import * as api from "./api";
import { bytesToHex, decryptEnvelope, decryptFileBytes, encryptFileBytes, encryptForRecipients, hexToBytes, packMessage, randomHex, sha256Hex, signMessage, utf8Decode, utf8Encode, verifyMessage } from "./crypto";
import { registerHostedRatchet, sendPilotMessage, verifiedContact } from "./hostedRatchetChat";
import { hostedGroupCredentials } from "./hostedGroupCredentials";
import { getBlob, setBlobDurably, setBlobsDurably } from "./lock";
import { createMlsGroupEngine } from "./mlsGroupEngine";
import { createMlsSubtleCrypto } from "./mlsMobileCrypto";

const queues = new Map();
const invitationDeliveries = new Map();
const PACKAGE_LIFETIME = 86_400_000;
const PACKAGE_BATCH = 8;
const MAX_LOCAL_HISTORY = 200;
export const PILOT_GROUP_AVATAR_LIMIT = 32 * 1024;
export const PILOT_GROUP_FILE_LIMIT = 96 * 1024;
export const PILOT_GROUP_UPLOAD_LIMIT = MAX_ATTACHMENT_BYTES;
const LOCAL_FILE_BUDGET = 384 * 1024;
const attachmentScope = (id, epoch, op, author, attachment) =>
  JSON.stringify(["ultron-mls-attachment-v1", id, epoch, op, author, attachment]);
function validAttachment(attachment) {
  if (!attachment || typeof attachment.name !== "string" || !attachment.name.trim() || attachment.name.length > 160 ||
      /[\x00-\x1f\x7f]/.test(attachment.name) || typeof attachment.mime !== "string" || attachment.mime.length > 120 ||
      !/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i.test(attachment.mime) || !Number.isSafeInteger(attachment.size) ||
      attachment.size < 1) return false;
  if ("id" in attachment) {
    return attachment.size <= PILOT_GROUP_UPLOAD_LIMIT &&
      (!("cs" in attachment || "n" in attachment) || (attachment.cs === ATTACHMENT_CHUNK_BYTES && attachment.n === Math.ceil(attachment.size / ATTACHMENT_CHUNK_BYTES))) && /^[a-f0-9]{32}$/.test(attachment.id || "") &&
      /^[a-f0-9]{64}$/.test(attachment.key || "") && /^[a-f0-9]{24}$/.test(attachment.iv || "") && !attachment.data;
  }
  if (attachment.size > PILOT_GROUP_FILE_LIMIT || typeof attachment.data !== "string" ||
      attachment.data.length !== 4 * Math.ceil(attachment.size / 3) ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(attachment.data)) return false;
  const padding = attachment.data.endsWith("==") ? 2 : attachment.data.endsWith("=") ? 1 : 0;
  return attachment.data.length * 3 / 4 - padding === attachment.size;
}
function appendHistory(history, message) {
  const kept = [...history, message].slice(-MAX_LOCAL_HISTORY);
  let remaining = LOCAL_FILE_BUDGET;
  for (let index = kept.length - 1; index >= 0; index--) {
    const entry = kept[index], data = entry.attachment?.data;
    if (!data) continue;
    if (data.length > remaining) {
      const { data: discard, ...metadata } = entry.attachment;
      kept[index] = { ...entry, attachment: metadata };
    } else remaining -= data.length;
  }
  return kept;
}
const profileScope = (id, epoch, op, author, profile) =>
  JSON.stringify(["ultron-mls-profile-v1", id, epoch, op, author, profile]);
function validProfile(profile) {
  return profile && typeof profile.description === "string" && profile.description.length <= 512 &&
    (profile.visibility === undefined || ["private", "public"].includes(profile.visibility)) &&
    (profile.avatar === null || (typeof profile.avatar === "string" && profile.avatar.length <= PILOT_GROUP_AVATAR_LIMIT &&
      /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(profile.avatar)));
}
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
const replyScope = (id, epoch, op, author, seq) => JSON.stringify(["ultron-mls-reply-v1", id, epoch, op, author, seq]);
const pollScope = (id, epoch, op, author, poll) => JSON.stringify(["ultron-mls-poll-v1", id, epoch, op, author, poll]);
const validPollId = (id) => typeof id === "string" && /^[0-9a-f]{32}$/.test(id);
const validChoice = (value, limit) => typeof value === "string" && value.trim() === value && value.length > 0 && value.length <= limit;
function validQuizChoices(options) {
  return Array.isArray(options) && options.length >= 2 && options.length <= 6 &&
    options.every(choice => validChoice(choice, 80)) && new Set(options).size === options.length;
}

export function preparePilotQuiz({ question, options, correct, explanation, link, file }) {
  const prompt = { question: question.trim(), options: options.map(option => option.trim()) };
  const solution = { correct, explanation: explanation.trim(), link: link.trim(), file };
  if (!validChoice(prompt.question, 140) || !validQuizChoices(prompt.options) ||
      !Number.isInteger(correct) || correct < 0 || correct >= prompt.options.length ||
      !validQuizSolution(solution)) throw new Error("Domanda, risposta o spiegazione del quiz non valida.");
  const seal = value => {
    const { key, iv, ciphertext } = encryptFileBytes(utf8Encode(JSON.stringify(value)));
    return { wire: { data: bytesToHex(ciphertext), iv }, key };
  };
  const sealedPrompt = seal(prompt);
  const sealedSolution = seal(solution);
  const id = randomHex(16);
  return {
    id,
    request: { action: "prepare", id, options: prompt.options.length, correct, prompt: sealedPrompt.wire, solution: sealedSolution.wire },
    event: { kind: "quiz", id, promptKey: sealedPrompt.key, solutionKey: sealedSolution.key },
    file: file?.id,
  };
}

function validQuizSolution(value) {
  return value && typeof value.explanation === "string" && value.explanation.length <= 500 &&
    typeof value.link === "string" && value.link.length <= 512 &&
    (!value.link || /^https?:\/\/[^\s]+$/i.test(value.link)) &&
    (!value.file || (validAttachment(value.file) && value.file.id &&
      /^(image|audio)\//i.test(value.file.mime)));
}

export function openPilotQuiz(event, state) {
  function decode(value, key) {
    if (typeof value?.data !== "string" || !/^(?:[0-9a-f]{2}){17,8192}$/.test(value.data) ||
        !/^[0-9a-f]{24}$/.test(value.iv || "")) throw new Error("Dati del quiz non validi.");
    return JSON.parse(utf8Decode(decryptFileBytes(hexToBytes(value.data), key, value.iv)));
  }
  const prompt = decode(state.prompt, event.promptKey);
  if (!validChoice(prompt?.question, 140) || !validQuizChoices(prompt.options)) throw new Error("Domanda del quiz non valida.");
  if (state.solution == null) return { ...prompt, started: state.started === true };
  const solution = decode(state.solution, event.solutionKey);
  if (!validQuizSolution(solution) || !Number.isInteger(state.correct) || state.correct < 0 ||
      state.correct >= prompt.options.length || state.correct !== solution.correct ||
      !Array.isArray(state.totals) || state.totals.length !== prompt.options.length || !state.totals.every(validNumber) ||
      (state.author !== true && (!Number.isInteger(state.choice) || state.choice < 0 || state.choice >= prompt.options.length))) {
    throw new Error("Risultati del quiz non validi.");
  }
  return { ...prompt, ...solution, started: state.started === true, author: state.author === true,
    choice: state.choice, totals: state.totals };
}

function validPoll(data, op, body) {
  if (!data || !validPollId(data.id)) return false;
  if (data.kind === "poll") return data.id === op && validChoice(body, 140) && validQuizChoices(data.options);
  if (data.kind === "quiz") {
    return data.id === op && body === "Quiz" && /^[a-f0-9]{64}$/.test(data.promptKey || "") &&
      /^[a-f0-9]{64}$/.test(data.solutionKey || "");
  }
  return data.kind === "vote" && Number.isInteger(data.choice) && data.choice >= 0 && data.choice < 6;
}

export function presentPilotGroupHistory(history, account) {
  const polls = new Map();
  const visible = [];
  for (const item of history) {
    if (item.poll?.kind === "vote") {
      const poll = polls.get(item.poll.id);
      if (poll && item.poll.choice < poll.options.length) poll.votes.set(item.sender, item.poll.choice);
      continue;
    }
    if (item.poll?.kind === "poll") polls.set(item.poll.id, { options: item.poll.options, votes: new Map() });
    visible.push(item);
  }
  return visible.map(item => {
    if (item.poll?.kind !== "poll") return item;
    const { options, votes } = polls.get(item.poll.id);
    const totals = options.map(() => 0);
    for (const choice of votes.values()) totals[choice]++;
    return { ...item, totals, choice: votes.get(account) };
  });
}

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
      !["review", "pending", "accepted", "declined", "verification"].includes(row.status)) throw new Error("Invito al gruppo non valido.");
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
  const blocked = new Set(await getBlob(blob(user, "blocked-groups")) || []);
  check();
  return rows.map(expectInvitation).filter(row => row.target === user.lns && !blocked.has(row.group));
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
  return rows.map(expectInvitation).filter(row => row.group === group.id && row.inviter === group.admin);
}

export async function requestPilotGroupInvitation(user, group, target) {
  const check = api.authenticatedScope(user);
  const credentials = await hostedGroupCredentials(user);
  if (!await credentials.identityFor(target)) throw new Error("Verifica il QR UNVOR del contatto.");
  check();
  const id = randomHex(16);
  const title = group.admin === user.lns ? await cachedPilotGroupTitle(user, group) : null;
  const key = await verifiedContact(user, target);
  const signature = title ? signMessage(inviteTitleScope(user.server, id, group.id, user.lns, target, title), user.sk) : null;
  const note = title ? JSON.stringify(encryptForRecipients(JSON.stringify({ title, signature }), { [target]: key.kem })[0]) : undefined;
  check();
  const answer = expectInvitation(await api.mlsRequestInvitation(group.id, { id, target, note }));
  check();
  if (answer.group !== group.id || answer.target !== target || answer.inviter !== group.admin) {
    throw new Error("Il gateway non ha confermato l’invito.");
  }
  await deliverPilotGroupInvitation(user, group, answer);
  return answer;
}

export async function deliverPilotGroupInvitation(user, group, invitation) {
  const check = api.authenticatedScope(user);
  expectInvitation(invitation);
  if (invitation.group !== group.id || invitation.inviter !== group.admin || invitation.status !== "pending") {
    throw new Error("Questo invito non è più in attesa.");
  }
  const key = blob(user, "notice:" + invitation.id);
  const inFlight = invitationDeliveries.get(key);
  if (inFlight) return inFlight;
  const delivery = (async () => {
    const saved = await getBlob(key);
    check();
    if (saved?.done) return;
    const title = group.title || await cachedPilotGroupTitle(user, group);
    const text = title ? `Invito al gruppo «${title}»` : "Invito a un gruppo UNVOR";
    const payload = saved?.payload || packMessage(text, [], null, 0, { id: invitation.id, group: group.id });
    if (!saved) await setBlobDurably(key, { payload });
    check();
    await sendPilotMessage(payload, user, invitation.target, { receiptName: key });
  })();
  invitationDeliveries.set(key, delivery);
  try { return await delivery; }
  finally { if (invitationDeliveries.get(key) === delivery) invitationDeliveries.delete(key); }
}

export async function decidePilotGroupInvitation(user, row, decision) {
  const check = api.authenticatedScope(user);
  expectInvitation(row);
  if (row.target !== user.lns || !["accepted", "declined"].includes(decision)) throw new Error("Decisione non valida.");
  const answer = await serial(user, async () => {
    check();
    const transcript = consentScope(user.server, row.group, row.id, row.inviter, row.target, decision);
    const signature = signMessage(transcript, user.sk);
    // Store the user's explicit decision before transmission so a lost reply
    // doesn't remove their ability to open the resulting Welcome.
    if (decision === "accepted") {
      await setBlobDurably(blob(user, "invite:" + row.id), { group: row.group, inviter: row.inviter, decision });
    }
    check();
    const answer = expectInvitation(await api.mlsDecideInvitation(row.id, { decision, signature }));
    check();
    if (answer.id !== row.id || answer.status !== decision) throw new Error("Decisione non confermata dal gateway.");
    return answer;
  });
  if (decision === "accepted") {
    // Consent is durable even while this installation still needs to publish
    // a package or verify the other party. Welcome continues to require both.
    preparePilotGroupInvites(user).catch(() => {});
    pilotInvitationTitle(user, row).then(async (title) => {
      check();
      if (title) await setBlobDurably(blob(user, "title:" + row.group), { admin: row.inviter, title });
    }).catch(() => {});
  }
  return answer;
}

export function preparePilotGroupInvites(user) {
  return serial(user, async () => {
    const check = api.authenticatedScope(user);
    const key = blob(user, "packages");
    let pool = await getBlob(key) || [];
    const now = Date.now();
    if (pool.filter(item => item.id && !item.used && now - item.at < PACKAGE_LIFETIME / 2).length >= 4) return;
    await registerHostedRatchet(user);
    check();
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
    ack = await api.mlsAppend(id, pending.body, pending.silent === true);
  } catch (error) {
    // The gateway checks the operation id before the current cursor. A 409
    // confirms this exact reservation did not commit on this group.
    if ([403, 404, 409].includes(error?.response?.status)) {
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
  if (pending.type === "title") {
    updated.title = pending.text;
    if (pending.profile) updated.profile = pending.profile;
    updated.profileAnnouncedEpoch = ack.epoch;
  } else if (pending.body.managed_profile) {
    updated.title = pending.managedTitle;
    updated.profile = pending.profile;
  }
  else if (pending.body.kind === "message") {
    updated.history = appendHistory(record.history, { seq: ack.seq, sender: user.lns, body: pending.text, poll: pending.poll,
      attachment: pending.attachment, replyTo: pending.replyTo, draftId: pending.draftId });
  }
  if (pending.nextMembers) updated.members = pending.nextMembers;
  else if (pending.body.kind !== "message") delete updated.members;
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
  if (record?.pending) {
    try { record = await flush(user, id, record, check); }
    catch (error) {
      if (error?.response?.status !== 409) throw error;
      record = { ...record, pending: null };
    }
  }
  for (let batch = 0; batch < 32; batch++) {
    check();
    const page = await api.mlsEvents(id, record?.cursor ?? row.since - 1);
    if (!Array.isArray(page?.events) || !validNumber(page.seq) || page.since !== row.since ||
        (record && page.seq < record.cursor)) throw new Error("Sequenza del gateway non valida.");
    let stored = record;
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
        const hint = await getBlob(blob(user, "title:" + id));
        record = { since: row.since, state, epoch: event.next_epoch, cursor: event.seq, history: [], pending: null,
          members: engine.members(state, id, event.next_epoch), title: hint?.admin === row.admin ? hint.title : undefined };
        check();
        await setBlobsDurably([[key, record], [poolKey, pool.filter(item => item.id !== found.id)]]);
        stored = record;
        continue;
      }

      if (event.seq !== record.cursor + 1) throw new Error("Mancano eventi nella chat di gruppo.");
      const decoded = await engine.receive(record.state, id, record.epoch, event, row.admin);
      let history = record.history, title = record.title, groupProfile = record.profile;
      if (decoded.payload !== null) {
        const { body, signature, type, poll, poll_signature, profile, profile_signature, attachment, attachment_signature, reply_to, reply_signature, title: managedTitle } = JSON.parse(decoded.payload);
        const author = await credentials.identityFor(event.author);
        if (typeof body !== "string" || !["text", "title"].includes(type) ||
            (type === "title" ? event.author !== row.admin || !body || body.length > 60 : body.length > 2000) || !/^[a-f0-9]{6618}$/.test(signature || "") ||
            !(record.members || engine.members(record.state, id, record.epoch)).includes(event.author) || !author ||
            !verifyMessage(messageScope(id, record.epoch, event.op, event.author, type, body), signature, author)) {
          throw new Error("Firma del messaggio di gruppo non valida.");
        }
        if (type === "title") {
          title = body;
          if (validProfile(profile) && /^[a-f0-9]{6618}$/.test(profile_signature || "") &&
              verifyMessage(profileScope(id, record.epoch, event.op, event.author, profile), profile_signature, author)) groupProfile = profile;
        } else if (event.managed_profile === true && validChoice(managedTitle, 60) && validProfile(profile) &&
            verifyMessage(profileScope(id, record.epoch, event.op, event.author, { title: managedTitle, profile }), profile_signature, author)) {
          title = managedTitle;
          groupProfile = profile;
        } else {
          const authenticatedPoll = validPoll(poll, event.op, body) && /^[a-f0-9]{6618}$/.test(poll_signature || "") &&
            verifyMessage(pollScope(id, record.epoch, event.op, event.author, poll), poll_signature, author);
          const authenticatedAttachment = validAttachment(attachment) &&
            (!attachment.id || event.file === attachment.id) && /^[a-f0-9]{6618}$/.test(attachment_signature || "") &&
            verifyMessage(attachmentScope(id, record.epoch, event.op, event.author, attachment), attachment_signature, author);
          const replyTo = Number.isSafeInteger(reply_to) && reply_to > 0 && reply_to < event.seq &&
            /^[a-f0-9]{6618}$/.test(reply_signature || "") &&
            verifyMessage(replyScope(id, record.epoch, event.op, event.author, reply_to), reply_signature, author) ? reply_to : undefined;
          history = appendHistory(history, { seq: event.seq, sender: event.author, body, replyTo, poll: authenticatedPoll ? poll : undefined,
            attachment: authenticatedAttachment ? attachment : undefined });
        }
      }
      const members = decoded.epoch === record.epoch && record.members ? record.members : engine.members(decoded.snapshot, id, decoded.epoch);
      record = { ...record, cursor: event.seq, epoch: decoded.epoch, state: decoded.snapshot, history, title, profile: groupProfile,
        members, lastAt: new Date().toISOString() };
    }
    if (record && stored !== record) {
      check();
      await setBlobDurably(key, record);
    }
    if (record?.cursor === page.seq) return record;
    if (!page.events.length) break;
  }
  throw new Error("La cronologia del gruppo è ancora in sincronizzazione.");
}

export function createPilotGroup(user, name, visibility = "private", avatar = null) {
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
      const profile = { description: "", avatar, visibility };
      if (!validProfile(profile)) throw new Error("Foto o visibilità del gruppo non valida.");
      pending = { id, signature, state, title, listing, profile };
      check();
      await setBlobDurably(draft, pending);
    }
    const { id, state, signature, title, listing, profile } = pending;
    check();
    const groupKey = blob(user, id);
    if (!await getBlob(groupKey)) {
      check();
      await setBlobDurably(groupKey, { since: 0, cursor: 0, epoch: 0, history: [], state, pending: null, title, profile, lastAt: new Date().toISOString() });
    }
    check();
    const res = await api.mlsCreate({ id, signature, listing });
    if (res?.id !== id) throw new Error("Creazione gruppo non confermata.");
    check();
    await setBlobDurably(draft, null);
    return { id, admin: user.lns, signature, since: 0, seq: 0, epoch: 0, title, profile };
  });
}

function detailsFor(engine, id, record) {
  return { title: record.title, profile: record.profile, history: record.history,
    members: record.members || engine.members(record.state, id, record.epoch) };
}

export async function pilotGroupPolicy(row) {
  if (typeof api.mlsPolicy !== "function") return null;
  try { return await api.mlsPolicy(row.id); }
  catch (error) { if (error?.response?.status === 404) return null; throw error; }
}

export async function verifyPilotGroupAccount(user) {
  const check = api.authenticatedScope(user);
  const signature = signMessage(JSON.stringify(["ultron-mls-account-v1", user.server, user.lns, user.pk]), user.sk);
  const result = await api.mlsVerifyAccount(signature);
  check();
  if (result?.verified !== true) throw new Error("Verifica dell’account non confermata.");
}

export function forgetPilotGroup(user, id, block = false) {
  return serial(user, async () => {
    const check = api.authenticatedScope(user);
    check();
    if (block) {
      const key = blob(user, "blocked-groups");
      const previous = await getBlob(key) || [];
      check();
      await setBlobDurably(key, [...new Set([...previous, id])]);
    }
    await setBlobDurably(blob(user, id), null);
  });
}

export async function finishAcceptedPilotGroupInvites(user, row) {
  if (row.admin !== user.lns) return;
  const policy = await pilotGroupPolicy(row);
  for (const account of policy?.leaving || []) await updatePilotGroup(user, row, "remove", account);
  const accepted = (await pilotGroupInvitations(user, row)).filter(invite => invite.status === "accepted");
  if (accepted.length) {
    let details = await openPilotGroup(user, row);
    for (const invite of accepted) {
      if (details.members.includes(invite.target)) continue;
      details = await updatePilotGroup(user, row, "add", invite.target, invite);
    }
  }
  await announcePilotGroupProfile(user, row);
}

export function announcePilotGroupProfile(user, row) {
  if (row.admin !== user.lns) return;
  return serial(user, async () => {
    const cached = await getBlob(blob(user, row.id));
    if (!cached?.title || cached.epoch === 0 || cached.profileAnnouncedEpoch === cached.epoch) return;
    const ctx = await context(user);
    const record = await sync(user, row, ctx);
    if (!record.title || record.profileAnnouncedEpoch === record.epoch) return;
    return writePilotGroup(user, row, record.profile ? "profile" : "title", record.profile || record.title, null, null, ctx, record);
  });
}

export function openPilotGroup(user, row, { read = false } = {}) {
  return serial(user, async () => {
    const ctx = await context(user);
    const record = await sync(user, row, ctx);
    const details = detailsFor(ctx.engine, row.id, record);
    if ((read && record.readThrough !== record.cursor) || !record.members) {
      ctx.check();
      await setBlobDurably(blob(user, row.id), { ...record, members: details.members,
        readThrough: read ? record.cursor : record.readThrough });
    }
    return details;
  });
}

export function updatePilotGroup(user, row, kind, value, invitation, draftId) {
  return serial(user, async () => {
    const ctx = await context(user);
    for (let attempt = 0; ; attempt++) {
      try { return await writePilotGroup(user, row, kind, value, invitation, draftId, ctx); }
      catch (error) {
        if (attempt || error?.response?.status !== 409 || !["message", "reply", "title", "profile", "managed-profile", "poll", "quiz", "vote", "attachment"].includes(kind)) throw error;
      }
    }
  });
}

async function writePilotGroup(user, row, kind, value, invitation, draftId, ctx, current) {
  const { engine, check, credentials } = ctx;
  const record = current || await sync(user, row, ctx);
  const { id } = row;
  if (draftId && record.history.some(item => item.draftId === draftId)) return detailsFor(engine, id, record);
  if (["message", "reply", "attachment"].includes(kind) && draftId && engine.members(record.state, id, record.epoch).length < 2) {
    throw new Error("Invita almeno un membro e attendi che l’ingresso sia completato.");
  }
  const body = { op: kind === "quiz" ? value.id : randomHex(16), cursor: record.cursor, epoch: record.epoch, kind: ["reply", "title", "profile", "managed-profile", "poll", "quiz", "vote", "attachment"].includes(kind) ? "message" : kind };
  let update;
  let text, type, poll, profile, attachment, managedTitle, replyTo;
  if (body.kind === "message") {
    type = ["title", "profile"].includes(kind) ? "title" : "text";
    if (kind === "reply") {
      if (!Number.isSafeInteger(value.seq) || !record.history.some(item => item.seq === value.seq && item.poll?.kind !== "vote")) {
        throw new Error("Messaggio originale non disponibile.");
      }
      text = value.text.trim();
      replyTo = value.seq;
    } else if (kind === "poll") {
      text = value.question.trim();
      poll = { kind: "poll", id: body.op, options: value.options.map(option => option.trim()) };
    } else if (kind === "quiz") {
      text = "Quiz";
      poll = value.event;
      if (!validPoll(poll, body.op, text)) throw new Error("Quiz non valido.");
      check();
      await api.mlsQuiz(id, value.request);
      check();
      body.quiz = true;
      if (value.file) body.file = value.file;
    } else if (kind === "vote") {
      const original = record.history.find(item => item.poll?.kind === "poll" && item.poll.id === value.id);
      if (!original || value.choice >= original.poll.options.length) throw new Error("Sondaggio non disponibile.");
      text = "🗳";
      poll = { kind: "vote", id: value.id, choice: value.choice };
    } else if (kind === "profile") {
      text = value.title?.trim() || record.title || row.title || "Gruppo";
      profile = { description: value.description.trim(), avatar: value.avatar };
      if (record.profile?.visibility) profile.visibility = record.profile.visibility;
      if (!validProfile(profile)) throw new Error("Descrizione o foto del gruppo non valida.");
    } else if (kind === "managed-profile") {
      managedTitle = value.title.trim();
      profile = { description: value.description.trim(), avatar: value.avatar };
      if (!validChoice(managedTitle, 60) || !validProfile(profile)) throw new Error("Descrizione o foto del gruppo non valida.");
      body.managed_profile = true;
      text = "Informazioni del gruppo aggiornate.";
    } else if (kind === "attachment") {
      attachment = value;
      if (!validAttachment(attachment)) throw new Error("Allegato del gruppo non valido.");
      text = attachment.name;
      if (attachment.id) body.file = attachment.id;
    } else {
      text = value.trim();
    }
    if (poll && !validPoll(poll, body.op, text)) throw new Error("Sondaggio non valido.");
    if (!text || (type === "title" ? text.length > 60 || row.admin !== user.lns : text.length > 2000) || utf8Encode(text).length > 8000) throw new Error("Messaggio di gruppo non valido.");
    const signature = signMessage(messageScope(id, record.epoch, body.op, user.lns, type, text), user.sk);
    const poll_signature = poll ? signMessage(pollScope(id, record.epoch, body.op, user.lns, poll), user.sk) : undefined;
    const profile_signature = profile ? signMessage(profileScope(id, record.epoch, body.op, user.lns, managedTitle ? { title: managedTitle, profile } : profile), user.sk) : undefined;
    const attachment_signature = attachment
      ? signMessage(attachmentScope(id, record.epoch, body.op, user.lns, attachment), user.sk) : undefined;
    const reply_signature = replyTo ? signMessage(replyScope(id, record.epoch, body.op, user.lns, replyTo), user.sk) : undefined;
    update = await engine.send(record.state, id, record.epoch,
      JSON.stringify({ body: text, signature, type, poll, poll_signature, profile, profile_signature, attachment, attachment_signature,
        reply_to: replyTo, reply_signature, title: managedTitle }));
  } else if (kind === "add" || kind === "remove") {
    if (row.admin !== user.lns) throw new Error("Solo l’amministratore può modificare i membri.");
    body.target = value.trim().toLowerCase();
    let keyPackage;
    if (kind === "add") {
      const members = engine.members(record.state, id, record.epoch);
      if (members.includes(body.target)) return detailsFor(engine, id, record);
      const identity = await credentials.identityFor(body.target);
      if (!identity) throw new Error("Per questo contatto manca l’impronta della firma nel QR UNVOR.");
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

  const nextMembers = body.kind === "message" ? undefined : engine.members(update.snapshot, id, record.epoch + 1);
  const pending = { body: { ...body, wire: update.wire }, snapshot: update.snapshot, text, type, poll, profile, attachment, managedTitle, replyTo, draftId, nextMembers,
    silent: !["message", "reply", "attachment", "poll", "quiz"].includes(kind) };
  const staged = { ...record, pending };
  check();
  await setBlobDurably(blob(user, id), staged);
  const completed = await flush(user, id, staged, check);
  return detailsFor(engine, id, completed);
}


export async function cachedPilotGroupDetails(user, row) {
  const check = api.authenticatedScope(user);
  const record = await getBlob(blob(user, row.id));
  check();
  if (record?.since !== row.since || !Array.isArray(record.members)) return null;
  return { title: record.title, profile: record.profile, history: record.history, members: record.members };
}

export async function cachedPilotGroupSummary(user, row) {
  const record = await getBlob(blob(user, row.id));
  if (record?.since !== row.since) {
    const hint = await getBlob(blob(user, "title:" + row.id));
    return hint?.admin === row.admin ? { title: hint.title } : {};
  }
  const unread = record.history.filter(item => item.seq > (record.readThrough ?? row.since) &&
    item.sender !== user.lns && item.poll?.kind !== "vote").length;
  return { title: record.title, avatar: record.profile?.avatar, visibility: record.profile?.visibility, lastAt: record.lastAt, cursor: record.cursor, unread };

}

export async function cachedPilotGroupTitle(user, row) {
  return (await cachedPilotGroupSummary(user, row)).title || null;
}
