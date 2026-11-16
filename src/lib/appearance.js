// ASPETTO DELL'APP — sfondo e accento scelti dall'utente. v2.3.3.
//
// `useTint()` è il gancio che le schermate usano per costruire i propri stili
// (`makeStyles(tint)`): pulsanti, lucchetti, icone, intestazioni e Costellazione seguono
// tutti la stessa tinta e si ridisegnano nell'istante in cui l'utente la cambia.
// Lo sfondo lo dipinge il contenitore radice (Shell in App.js) tramite `useLook()`.
import { useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "ultron.look.blue.v1";

// Sei accenti. Non sedici: sei, scelti perché si leggono tutti su fondo scuro con lo
// stesso contrasto. Il colore cambia l'umore dell'app, non la sua leggibilità.
export const ACCENTS = [
  { id: "smeraldo", label: "Verde Smeraldo", color: "#50C878", deep: "#1E5637" },
  { id: "blu", label: "Blu Elettrico", color: "#72C7FF", deep: "#133762" },
  { id: "oro", label: "Giallo Oro", color: "#E8B33C", deep: "#6B4E12" },
  { id: "rubino", label: "Rosso Rubino", color: "#E0475F", deep: "#6B1622" },
  { id: "arancio", label: "Arancione Vivace", color: "#FF7A2F", deep: "#7A3410" },
  { id: "argento", label: "Bianco Argento", color: "#DCE3E8", deep: "#4A5158" },
];

export const BACKGROUNDS = [
  { id: "nero", label: "Deep Black", color: "#000000", surface: "#0A0A0A", surfaceAlt: "#121212", border: "#1C1C1C" },
  { id: "blunotte", label: "Midnight Blue", color: "#050E1F", surface: "#09182D", surfaceAlt: "#102440", border: "#25476B" },
  { id: "foresta", label: "Forest Green", color: "#00110A", surface: "#061A10", surfaceAlt: "#0A2417", border: "#123522" },
];

let current = { accent: "blu", bg: "blunotte" };
const listeners = new Set();

export function get() { return current; }
export const accent = () => ACCENTS.find((a) => a.id === current.accent) || ACCENTS[0];
export const background = () => BACKGROUNDS.find((b) => b.id === current.bg) || BACKGROUNDS[0];
export function accentColor() { return accent().color; }
export function accentDeep() { return accent().deep; }
export function bgColor() { return background().color; }

function notify() {
  listeners.forEach((f) => { try { f(current); } catch { /* niente */ } });
}

export async function load() {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (raw) {
      const next = Object.assign({}, current, JSON.parse(raw));
      const changed = next.accent !== current.accent || next.bg !== current.bg;
      current = next;
      if (changed) notify();
    }
  } catch { /* si tengono i valori di partenza */ }
  return current;
}

export async function set(patch) {
  current = Object.assign({}, current, patch || {});
  try { await AsyncStorage.setItem(KEY, JSON.stringify(current)); } catch { /* niente */ }
  notify();
  return current;
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/// Colore d'accento attivo, con ridisegno automatico quando cambia.
export function useTint() {
  const [c, setC] = useState(accentColor());
  useEffect(() => {
    setC(accentColor());
    return subscribe(() => setC(accentColor()));
  }, []);
  return c;
}

/// Scelta completa: accento, sfondo e le superfici calibrate su quello sfondo.
export function useLook() {
  const [v, setV] = useState(() => ({ ...current, ...background(), tint: accentColor(), deep: accentDeep() }));
  useEffect(() => {
    const calc = () => setV({ ...current, ...background(), tint: accentColor(), deep: accentDeep() });
    calc();
    return subscribe(calc);
  }, []);
  return v;
}

load().catch(() => {});
