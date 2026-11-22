import { RATCHET_PILOT } from "../config";
import React, { createContext, useContext, useEffect, useState, useCallback, useRef, useMemo } from "react";
import { AppState } from "react-native";
import { useAuth } from "./AuthContext";
import * as api from "../lib/api";
import { isOwner } from "../lib/canary";

const UnreadCtx = createContext({ chatUnread: 0, expiringLicenses: 0, bookRequests: 0, refresh: () => {}, updateContactRequests: () => {} });

export function UnreadProvider({ children }) {
  const { user } = useAuth();
  const [chatUnread, setChatUnread] = useState(0);
  const [expiringLicenses, setExpiringLicenses] = useState(0);
  const [bookRequests, setBookRequests] = useState(0);
  const busy = useRef(false);
  const fast = useRef(false);
  const contactFlight = useRef(null);
  const contactRevision = useRef(0);
  const activeUser = useRef(user);
  activeUser.current = user;

  const updateContactRequests = useCallback((rows) => {
    if (activeUser.current !== user) return;
    contactRevision.current += 1;
    setBookRequests((Array.isArray(rows) ? rows : []).filter((c) =>
      !c.blocked && (RATCHET_PILOT ? c.contact_request === "incoming"
        : c.they_have_me && c.in_my_book === false && !c.blind)).length);
  }, [user]);

  // Separate flight: slow chat badges must never delay incoming contact requests.
  const refreshContacts = useCallback(async () => {
    if (!user || contactFlight.current?.user === user) return;
    const flight = { user, revision: contactRevision.current };
    contactFlight.current = flight;
    try {
      const rows = await api.contactsRaw();
      if (activeUser.current === user && contactRevision.current === flight.revision) updateContactRequests(rows);
    } catch { /* Keep the last confirmed count during a network failure. */ }
    finally {
      if (contactFlight.current === flight) contactFlight.current = null;
    }
  }, [user, updateContactRequests]);

  // GIRO VELOCE: solo i due numeri che cambiano quando arriva un messaggio, in una sola
  // interrogazione. È questo che fa comparire il pallino entro un secondo.
  const tick = useCallback(async () => {
    if (!user || fast.current) return;
    fast.current = true;
    try {
      const b = await api.badges();
      // I gruppi stanno dentro Pulse: il pallino li comprende, altrimenti racconta metà
      // della storia.
      setChatUnread((Number(b?.chat) || 0) + (Number(b?.groups) || 0));
    } catch {}
    fast.current = false;
  }, [user]);

  const refresh = useCallback(async () => {
    if (!user || busy.current) return;
    busy.current = true;
    // Start all independent counters immediately, even if the chat endpoint stalls.
    const counters = Promise.all([tick(), refreshContacts()]);
    // Licenze in scadenza/scadute (solo owner) → pallino sul tab Impostazioni.
    if (isOwner(user)) {
      try {
        const ts = await api.consoleTenants();
        setExpiringLicenses((Array.isArray(ts) ? ts : []).filter((t) => {
          const trial = t.is_trial === true || t.status === "trial";
          const perpetual = !trial && (t.perpetual === true || t.billing === "perpetual" || !t.expires_at);
          return !perpetual && t.days_left != null && t.days_left <= 7;
        }).length);
      } catch {}
    } else {
      setExpiringLicenses(0);
    }
    await counters;
    busy.current = false;
  }, [user, tick, refreshContacts]);

  useEffect(() => {
    if (!user) { setChatUnread(0); setExpiringLicenses(0); setBookRequests(0); return; }
    setBookRequests(0);
    refreshContacts();
    refresh();
    const contactId = setInterval(() => { if (AppState.currentState === "active") refreshContacts(); }, 5000);
    const fastId = setInterval(() => { if (AppState.currentState === "active") tick(); }, 1500);
    const slowId = setInterval(() => { if (AppState.currentState === "active") refresh(); }, 30000);
    const sub = AppState.addEventListener("change", (s) => { if (s === "active") { refreshContacts(); refresh(); } });
    return () => { clearInterval(fastId); clearInterval(contactId); clearInterval(slowId); sub.remove(); };
  }, [user, refresh, tick, refreshContacts]);

  return (
    <UnreadCtx.Provider value={useMemo(() => ({ chatUnread, expiringLicenses, bookRequests, refresh, updateContactRequests }), [chatUnread, expiringLicenses, bookRequests, refresh, updateContactRequests])}>
      {children}
    </UnreadCtx.Provider>
  );
}

export const useUnread = () => useContext(UnreadCtx);
