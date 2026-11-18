import { groupAuthenticationService } from "./groupMemberProof";
import { createMlsGroupEngine } from "./mlsGroupEngine";
import { createMlsSubtleCrypto } from "./mlsMobileCrypto";
import { volatileMailbox } from "./volatileRelayTransport";

export function validateRelayLabProfile(profile, owner) {
  const { registration, pairing, mine, peer, grant } = profile ?? {};
  const address = /^[a-z0-9._-]{3,32}@ultron\.uns$/;
  if (profile?.version !== 1 || profile.owner !== owner ||
      !address.test(mine?.account) || !address.test(peer?.account) || mine.account === peer.account ||
      typeof registration?.origin !== "string" || !/^https:\/\/[a-zA-Z0-9.-]+(?::\d{1,5})?$/.test(registration.origin) ||
      !/^[a-f0-9]{64}$/.test(registration.token) || !/^[a-f0-9]{8064}$/.test(registration.secretKey) ||
      !/^[a-f0-9]{32}$/.test(registration.installation) ||
      !/^[a-f0-9]{64}$/.test(pairing?.id) || !Number.isSafeInteger(pairing.epoch) || pairing.epoch < 1 ||
      typeof pairing.snapshot !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(pairing.snapshot) ||
      ![mine.account, peer.account].includes(pairing.founder) || grant?.publicKey !== mine.publicKey ||
      !/^[a-f0-9]{64}$/.test(grant?.boot) || !/^[a-f0-9]{6618}$/.test(grant.authoritySignature) ||
      !Number.isSafeInteger(grant.expires) || mine.mailbox !== volatileMailbox(mine.publicKey) ||
      peer.mailbox !== volatileMailbox(peer.publicKey) || registration.mailbox !== mine.mailbox) {
    throw new Error("Profilo pilota non valido per questo account.");
  }
  return profile;
}

export async function relayLabEngine({ registration, mine, peer }) {
  if (!globalThis.crypto?.getRandomValues) throw new Error("Generatore sicuro Android non disponibile.");
  if (!globalThis.crypto.subtle) Object.defineProperty(globalThis.crypto, "subtle", { value: createMlsSubtleCrypto() });
  await import("fast-text-encoding");
  const [mls, { defaultClientConfig }] = await Promise.all([import("ts-mls"), import("ts-mls/clientConfig.js")]);
  return createMlsGroupEngine(mls, defaultClientConfig, {
    authService: groupAuthenticationService(registration.origin, async (name, installation) =>
      [mine, peer].find(member => member.account === name && member.mailbox === installation)?.publicKey),
  });
}
