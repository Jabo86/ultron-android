export function contactAddress(input) {
  const value = String(input || "").trim().toLowerCase();
  if (!/^[a-z0-9._-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.(uns|lns)$/.test(value) || value.length > 254) return "";
  return value;
}

export function matchesContact(contact, query) {
  const search = query.trim().toLowerCase();
  return [contact.display_name, contact.lns, contact.company_name]
    .some((value) => String(value || "").toLowerCase().includes(search));
}
