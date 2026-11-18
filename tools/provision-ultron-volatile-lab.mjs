import { createHash, randomBytes, webcrypto } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as mls from "ts-mls";
import { defaultClientConfig } from "ts-mls/clientConfig.js";
import { ml_dsa65 } from "@noble/post-quantum/ml-dsa.js";
import { createMlsGroupEngine } from "../src/lib/mlsGroupEngine.js";
import { createMlsSubtleCrypto } from "../src/lib/mlsMobileCrypto.js";
import { groupAuthenticationService, signGroupCredential } from "../src/lib/groupMemberProof.js";
import { volatileMailbox } from "../src/lib/volatileRelayTransport.js";

const [, , command, dir, origin, first, second] = process.argv;
const usage = "init DIR | pair DIR HTTPS_ORIGIN ACCOUNT_A ACCOUNT_B | renew DIR ACCOUNT";
if (!dir || !["init", "pair", "renew"].includes(command)) throw new Error(usage);
const authorityPath = join(dir, "authority-private.hex");
const profilePath = index => join(dir, ["relay-a.json", "relay-b.json"][index]);
const hex = bytes => Buffer.from(bytes).toString("hex");
const writeNew = (path, value) => writeFile(path, value, { mode: 0o600, flag: "wx" });
const sha = value => createHash("sha256").update(value).digest();
const hostPattern = /^https:\/\/[a-zA-Z0-9.-]+(?::\d{1,5})?(?:\/relay-lab)?$/;
const accountPattern = /^[a-z0-9._-]{3,32}@ultron\.uns$/;

Object.defineProperty(globalThis, "crypto", {
  value: { getRandomValues: webcrypto.getRandomValues.bind(webcrypto), subtle: createMlsSubtleCrypto() },
});

async function bootFor(host) {
  if (!hostPattern.test(host)) throw new Error("Serve un’origine HTTPS dedicata al relay di prova.");
  const reply = await fetch(host + "/v1/admission/info", { redirect: "error", signal: AbortSignal.timeout(6000) });
  if (!reply.ok) throw new Error("Relay di prova non raggiungibile.");
  const { boot } = await reply.json();
  if (!/^[a-f0-9]{64}$/.test(boot)) throw new Error("Avvio relay non valido.");
  return boot;
}

function grant(profile, boot, authority) {
  const expires = Math.floor(Date.now() / 1000) + 290;
  const time = Buffer.alloc(8);
  time.writeBigUInt64BE(BigInt(expires));
  const publicKey = profile.mine.publicKey;
  const input = Buffer.concat([Buffer.from(boot, "hex"), time, sha(Buffer.from(publicKey, "hex")),
    sha(Buffer.from(profile.registration.token, "hex"))]);
  return { boot, expires, publicKey, authoritySignature: hex(ml_dsa65.sign(input, authority.secretKey,
    { context: Buffer.from("ULTRON relay admission v1") })) };
}

if (command === "init") {
  await mkdir(dir, { mode: 0o700 });
  const seed = randomBytes(32);
  const authority = ml_dsa65.keygen(seed);
  await writeNew(authorityPath, hex(seed) + "\n");
  seed.fill(0);
  await writeNew(join(dir, "authority-public.hex"), hex(authority.publicKey) + "\n");
  console.log("Autorità di laboratorio creata. Sul relay serve solo authority-public.hex.");
} else {
  const seed = (await readFile(authorityPath, "utf8")).trim();
  if (!/^[a-f0-9]{64}$/.test(seed)) throw new Error("Chiave dell’autorità non valida.");
  const authority = ml_dsa65.keygen(Buffer.from(seed, "hex"));
  if (command === "pair") {
    if (![first, second].every(value => typeof value === "string" && accountPattern.test(value)) || first === second) throw new Error(usage);
    const boot = await bootFor(origin);
    const local = [first, second].map(account => {
      const key = ml_dsa65.keygen(randomBytes(32));
      const publicKey = hex(key.publicKey);
      const mailbox = volatileMailbox(publicKey);
      return { member: { account, publicKey, mailbox }, secretKey: hex(key.secretKey) };
    });
    const engines = await Promise.all(local.map(({ member, secretKey }) => createMlsGroupEngine(mls, defaultClientConfig, {
      authService: groupAuthenticationService(origin, async (account, device) => local
        .find(row => row.member.account === account && row.member.mailbox === device)?.member.publicKey),
      createCredential: publicKey => ({ credentialType: "basic", identity: signGroupCredential(
        { server: origin, lns: member.account, sk: secretKey }, member.mailbox, publicKey,
      ) }),
    })));
    const id = hex(randomBytes(32));
    const keyPackage = await engines[1].createKeyPackage();
    const initial = await engines[0].create(id);
    const invited = await engines[0].change(initial, id, 0, "add", second, keyPackage.wire);
    const snapshots = [invited.snapshot, await engines[1].join(id, 1, invited.welcome, keyPackage, first)];
    for (const [index, { member, secretKey }] of local.entries()) {
      const profile = { version: 1, owner: member.account, mine: member, peer: local[1 - index].member,
        registration: { origin, token: hex(randomBytes(32)), mailbox: member.mailbox, installation: hex(randomBytes(16)), secretKey },
        pairing: { id, epoch: 1, founder: first, snapshot: snapshots[index] } };
      profile.grant = grant(profile, boot, authority);
      await writeNew(profilePath(index), JSON.stringify(profile) + "\n");
    }
    console.log("Coppia di laboratorio creata. Importa un file per telefono entro cinque minuti.");
  } else {
    const profiles = await Promise.all([0, 1].map(async index => JSON.parse(await readFile(profilePath(index), "utf8"))));
    const index = profiles.findIndex(profile => profile.owner === origin);
    if (index < 0) throw new Error(usage);
    const profile = profiles[index];
    const boot = await bootFor(profile.registration.origin);
    profile.grant = grant(profile, boot, authority);
    await writeNew(join(dir, `relay-${index === 0 ? "a" : "b"}-${Date.now()}.json`), JSON.stringify(profile) + "\n");
    console.log("Nuova autorizzazione per l’account scelto. La coppia MLS resta identica.");
  }
  authority.secretKey.fill(0);
}
