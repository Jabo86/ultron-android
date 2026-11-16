import * as api from "./api";
import { deviceId } from "./devices";
import { hostedRatchetPilot, verifiedContact } from "./hostedRatchetChat";
import { hostedPrekeyDevice, parsePools } from "./hostedPrekeys";
import { groupAuthenticationService, groupIdentityFingerprint, signGroupCredential } from "./groupMemberProof";
import { getVerified } from "./verify";

export async function hostedGroupCredentials(user) {
  if (!hostedRatchetPilot(user)) throw new Error("I gruppi MLS richiedono il gateway pilota ULTRON.");
  const check = api.authenticatedScope(user);
  const installation = hostedPrekeyDevice(user, await deviceId());
  check();
  const identities = new Map();

  function readIdentity(account) {
    if (!identities.has(account)) {
      const operation = Promise.all([
        account === user.lns ? { identityKey: user.pk } : verifiedContact(user, account),
        api.hostedPrekeyPools(account),
        account === user.lns ? null : getVerified(account),
      ]).then(([bundle, response, pinned]) => {
        check();
        const fp = groupIdentityFingerprint(account, bundle.identityKey);
        const identity = account === user.lns || (fp && pinned?.identityFp === fp) ? bundle.identityKey : null;
        return { identity, devices: parsePools(response).map(item => item.device) };
      });
      identities.set(account, operation);
    }
    return identities.get(account);
  }

  // One operation (join, commit or validation) gets a consistent snapshot of
  // the verified contacts and active pilot installations it encounters.
  return {
    createCredential(publicKey) {
      check();
      return { credentialType: "basic", identity: signGroupCredential(user, installation, publicKey) };
    },
    async identityFor(account) {
      check();
      return (await readIdentity(account)).identity;
    },
    authService: groupAuthenticationService(user.server, async (account, device) => {
      check();
      if (account === user.lns && device !== installation) return null;
      const row = await readIdentity(account);
      check();
      return row.devices.length === 1 && row.devices[0] === device ? row.identity : null;
    }),
  };
}
