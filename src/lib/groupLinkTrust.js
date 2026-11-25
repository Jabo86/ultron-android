// Trust for MLS groups joined by an invitation link.
// A link is a bearer invitation; the fingerprint in the link anchors the
// founder's signing identity without adding anybody to the 1:1 address book.
import { getBlob, setBlobDurably } from "./lock";
import { sha256Hex } from "./crypto";
import { groupIdentityFingerprint } from "./groupMemberProof";
import { hostedSignedChatKeys } from "./signedChatKeys";
import { getVerified } from "./verify";
import * as api from "./api";

const keyOf = (user, group) => "mls-link-trust:" + sha256Hex(JSON.stringify([user.server, user.lns, group]));

export async function groupLinkTrust(user, group) {
  return getBlob(keyOf(user, group));
}

export function myGroupLinkFingerprint(user) {
  const fp = groupIdentityFingerprint(user?.lns, user?.pk);
  if (!fp) throw new Error("Identita UNVOR non disponibile per il link del gruppo.");
  return fp;
}

// A moderator can generate the link, but the Welcome is signed by the
// founder. Bind the invitation to the actual founder, not its generator.
export async function founderGroupLinkFingerprint(user, founder) {
  if (founder === user.lns) return myGroupLinkFingerprint(user);
  const check = api.authenticatedScope(user);
  const bundle = await hostedSignedChatKeys(user.lns, founder, () => {});
  check();
  const fp = groupIdentityFingerprint(founder, bundle?.identityKey);
  if (!fp) throw new Error("Chiavi firmate del fondatore non disponibili.");
  const qr = await getVerified(founder);
  if (qr?.identityFp && qr.identityFp !== fp) {
    throw new Error("La chiave d'identita del fondatore e cambiata.");
  }
  return fp;
}

// The gateway validates the secret group link. The client validates the founder
// identity independently, using only the fingerprint carried by that same link.
export async function trustRedeemedGroupLink(user, invitation, expectedFingerprint) {
  const check = api.authenticatedScope(user);
  if (!invitation?.link || invitation.target !== user.lns ||
      !/^[a-f0-9]{64}$/.test(invitation.group || "") || !invitation.inviter) {
    throw new Error("Invito tramite link non valido.");
  }
  const prior = await groupLinkTrust(user, invitation.group);
  check();
  const qr = await getVerified(invitation.inviter);
  const anchored = expectedFingerprint || qr?.identityFp || prior?.founderFingerprint;
  if (!/^[a-f0-9]{64}$/.test(anchored || "")) {
    throw new Error("Link senza impronta crittografica: richiedi il nuovo link UNVOR al fondatore.");
  }
  if (prior && (prior.founder !== invitation.inviter || prior.founderFingerprint !== anchored)) {
    throw new Error("L'identita del fondatore non corrisponde al link gia verificato.");
  }
  // Signed account keys are validated by the chat signature verifier.
  // They DO NOT put the invited person in the normal address book.
  const bundle = await hostedSignedChatKeys(user.lns, invitation.inviter, () => {});
  check();
  const fp = groupIdentityFingerprint(invitation.inviter, bundle?.identityKey);
  if (fp !== anchored || (qr?.identityFp && qr.identityFp !== fp)) {
    throw new Error("La firma del fondatore non corrisponde all'impronta nel link UNVOR.");
  }
  await setBlobDurably(keyOf(user, invitation.group), {
    founder: invitation.inviter, founderFingerprint: anchored, source: "signed-link",
  });
  check();
  return true;
}
