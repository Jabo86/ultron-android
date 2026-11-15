// CHAT ISTANTANEA — l'ultima pagina di ogni conversazione tenuta sul telefono.
// Prima di aprire una chat si aspettava la rete: con la linea lenta la schermata restava
// vuota per secondi. Qui si conservano le BUSTE CIFRATE così come arrivano dal server
// (nessun testo in chiaro in più sul telefono: la decifratura resta in memoria) dentro un
// blob a sua volta cifrato con la chiave del dispositivo — con il PIN attivo non è
// leggibile finché non sblocchi. Alla riapertura la chat compare subito, poi la rete
// aggiorna quello che è cambiato.
import * as lock from "./lock";
import { sha256Hex } from "./crypto";
import { RATCHET_PILOT } from "../config";

const NAME = (cid, user) => RATCHET_PILOT && user?.lns
  ? "cc:" + sha256Hex(JSON.stringify([user.server, user.lns, cid]))
  : "cc:" + String(cid || "");
const MAX = 40;
const sigs = new Map(); // conv_id -> firma di ciò che è già stato scritto

export async function read(cid, user) {
  if (!cid) return null;
  try {
    const v = await lock.getBlob(NAME(cid, user));
    if (Array.isArray(v)) return v.length ? v : null;
    if (!RATCHET_PILOT || !user?.lns) return null;
    const legacy = await lock.getBlob(NAME(cid));
    if (!Array.isArray(legacy) || !legacy.length || !legacy.every((m) =>
      m.conv_id === cid && (m.mine ? m.from_lns === user.lns : m.to_lns === user.lns)
    )) return null;
    return legacy;
  } catch { return null; }
}

/// Scrittura accorpata e solo se qualcosa è cambiato: il poll gira ogni 4 secondi e
/// ricifrare l'intera pagina ogni volta sarebbe uno spreco.
export function save(cid, raw, user) {
  if (!cid || !Array.isArray(raw)) return;
  const name = NAME(cid, user);
  const cut = raw.slice(-MAX);
  let sig = cut.length + "#";
  for (const m of cut) sig += String(m.message_id) + (m.delivered ? "d" : "") + (m.read ? "r" : "") + (m.edited ? "e" : "") + (m.hidden ? "h" : "") + "|";
  if (sigs.get(name) === sig) return;
  sigs.set(name, sig);
  try { lock.setBlobSoon(name, cut); } catch { /* si riproverà */ }
}

export async function drop(cid, user) {
  const name = NAME(cid, user);
  sigs.delete(name);
  try { await lock.removeBlob(name); } catch { /* niente */ }
}
