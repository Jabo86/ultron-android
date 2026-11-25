import * as api from "./api";
import { deviceId } from "./devices";
import { hostedRatchetPilot, verifiedContact } from "./hostedRatchetChat";
import { hostedSignedChatKeys } from "./signedChatKeys";
import { groupLinkTrust } from "./groupLinkTrust";
import { hostedPrekeyDevice, parsePools } from "./hostedPrekeys";
import { groupAuthenticationService, groupIdentityFingerprint, signGroupCredential } from "./groupMemberProof";
import { getVerified } from "./verify";

const recentIdentities = new Map();
const IDENTITY_TTL = 8000;

export async function hostedGroupCredentials(user, groupId = null) {
  if (!hostedRatchetPilot(user)) throw new Error("I gruppi MLS richiedono il gateway pilota UNVOR.");
  const check = api.authenticatedScope(user);
  const installation = hostedPrekeyDevice(user, await deviceId());
  check();
  const identities = new Map();
  const devices = new Map();

  async function verifiedIdentity(account) {
    check();
    if (account === user.lns) return user.pk;
    const pinned = await getVerified(account);
    check();
    if (!pinned?.fp && !pinned?.identityFp) {
      // In an MLS group, an invited participant need not be in the 1:1
      // address book. Verify signed account keys and pin their first identity.
      // If a bearer link anchored the founder, that fingerprint is mandatory.
      if (!groupId) return null;
      const signed = await hostedSignedChatKeys(user.lns, account, () => {});
      check();
      const fp = groupIdentityFingerprint(account, signed?.identityKey);
      if (!fp) return null;
      const link = await groupLinkTrust(user, groupId);
      check();
      if (link?.founder === account && link.founderFingerprint !== fp) {
        throw new Error("L'identita del fondatore non coincide con il link.");
      }
      return signed.identityKey;
    }
    const cacheKey = JSON.stringify([user.server, user.lns, user.pk, account]);
    const fingerprint = JSON.stringify([pinned.fp, pinned.identityFp, pinned.at]);
    const now = Date.now();
    const cached = recentIdentities.get(cacheKey);
    if (cached?.fingerprint === fingerprint && cached.expires > now) return cached.key;

    // The direct-chat lookup checks the saved encryption fingerprint and the
    // signing identity previously pinned by this account. ULTRON2 QR pins,
    // when present, still have to match independently.
    const bundle = await verifiedContact(user, account);
    check();
    const fp = groupIdentityFingerprint(account, bundle.identityKey);
    if (!fp || (pinned.identityFp && pinned.identityFp !== fp)) return null;
    const current = await getVerified(account);
    check();
    if (JSON.stringify([current?.fp, current?.identityFp, current?.at]) !== fingerprint) return null;
    if (recentIdentities.size >= 128) recentIdentities.delete(recentIdentities.keys().next().value);
    recentIdentities.set(cacheKey, { fingerprint, expires: now + IDENTITY_TTL, key: bundle.identityKey });
    return bundle.identityKey;
  }

  function identityFor(account) {
    check();
    if (!identities.has(account)) identities.set(account, verifiedIdentity(account));
    return identities.get(account);
  }

  function activeDevices(account) {
    if (!devices.has(account)) {
      devices.set(account, api.hostedPrekeyPools(account).then(reply => {
        check();
        return parsePools(reply);
      }));
    }
    return devices.get(account);
  }

  return {
    createCredential(publicKey) {
      check();
      return { credentialType: "basic", identity: signGroupCredential(user, installation, publicKey) };
    },
    identityFor,
    authService: groupAuthenticationService(user.server, async (account, device) => {
      check();
      if (account === user.lns && device !== installation) return null;
      const identity = await identityFor(account);
      if (!identity) return null;
      const active = await activeDevices(account);
      check();
      return active.length === 1 && active[0].device === device ? identity : null;
    }),
  };
}
