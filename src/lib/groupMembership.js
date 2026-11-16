export function groupContactOptions(contacts, excluded = []) {
  if (!Array.isArray(contacts)) return [];
  const skip = new Set(excluded);
  return contacts.filter(contact => contact?.lns && !skip.has(contact.lns) && !contact.blocked &&
    (contact.has_key === true || (contact.has_key == null && contact.mutual === true)));
}

// Group keys are wrapped with the member's static ML-KEM key. The group
// envelope has no device/prekey identifier, unlike the direct-message format.
export async function groupMemberEnvelopes(addresses, groupKey, fetchStaticKeys, wrap, missingKeysError) {
  const members = [...new Set(addresses)];
  const staticKeys = new Map();
  for (let offset = 0; offset < members.length; offset += 32) {
    const batch = members.slice(offset, offset + 32);
    const keys = await fetchStaticKeys(batch);
    for (const address of batch) {
      const key = keys?.[address];
      if (typeof key === "string" && /^[a-f0-9]{2368}$/i.test(key)) staticKeys.set(address, key);
    }
  }
  const missing = members.filter(address => !staticKeys.has(address));
  if (missing.length) throw missingKeysError(missing);
  return members.map(lns => ({ lns, role: "member", key_env: wrap(groupKey, staticKeys.get(lns)) }));
}
