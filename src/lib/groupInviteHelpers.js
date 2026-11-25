// Codici di invito UNVOR, compatibili con il protocollo usato dalle build precedenti.
const CODE = /^[a-f0-9]{64}\.[a-f0-9]{64}$/i;
const URI = /^(?:unvor|ultron):\/\/group-invite\/([a-f0-9]{64}\.[a-f0-9]{64})\/?$/i;
export function parseGroupInviteLink(value) {
  const input = String(value || "").trim();
  const uri = URI.exec(input);
  const code = uri ? uri[1] : input;
  return CODE.test(code) ? code.toLowerCase() : null;
}
export function formatGroupInviteLink(value) {
  const code = parseGroupInviteLink(value);
  if (!code) throw new Error("Codice d'invito UNVOR non valido.");
  return "unvor://group-invite/" + code;
}

// Mostra anche i contatti locali, indipendentemente dalla verifica QR.
// L'autorizzazione effettiva all'invito rimane lato gateway e nel protocollo MLS.
export function displayGroupContacts(remote, local, me) {
  const mine = String(me || "").toLowerCase();
  const byAccount = new Map();
  for (const entry of Array.isArray(remote) ? remote : []) {
    const lns = String(entry?.lns || "").trim().toLowerCase();
    if (!/^[a-z0-9._-]+@ultron\.uns$/.test(lns) || lns === mine || entry?.in_my_book === false) continue;
    byAccount.set(lns, { ...entry, lns });
  }
  for (const entry of Array.isArray(local) ? local : []) {
    const lns = String(entry?.lns || "").trim().toLowerCase();
    if (!/^[a-z0-9._-]+@ultron\.uns$/.test(lns) || lns === mine) continue;
    const old = byAccount.get(lns);
    const merged = { ...old, ...entry, lns,
      display_name: entry.name || old?.display_name || lns.split("@")[0],
      blocked: !!old?.blocked || !!entry.blocked,
      favorite: !!old?.favorite || !!entry.favorite,
      mutual: old?.mutual === true || (old?.in_my_book === true && old?.they_have_me === true) };
    byAccount.set(lns, merged);
  }
  return [...byAccount.values()].filter(e => !e.blocked).sort((a, b) =>
    Number(!!b.favorite) - Number(!!a.favorite) ||
    String(a.display_name || a.lns).localeCompare(String(b.display_name || b.lns)));
}
