// Search only text and filenames already decrypted on this device. No file body
// or query is uploaded, and search never advances a receiving ratchet.
export function matchSearchContent(body, attachments, query) {
  const term = String(query || "").trim().toLocaleLowerCase();
  if (!term) return null;
  const files = (Array.isArray(attachments) ? attachments : [])
    .filter(file => typeof file?.name === "string" && file.name.toLocaleLowerCase().includes(term))
    .map(file => file.name);
  const text = typeof body === "string" ? body : "";
  if (!files.length && !text.toLocaleLowerCase().includes(term)) return null;
  return { text, files };
}
