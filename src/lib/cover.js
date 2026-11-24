// TRAFFICO DI COPERTURA LEGACY. Questo invia richieste GET /api/health casuali; non usa
// lo stesso endpoint né lo stesso formato dei messaggi e quindi NON rende i messaggi
// indistinguibili. Serve solo come rumore di fondo limitato. La copertura reale richiede
// frame cifrati, di lunghezza fissa, inviati sullo stesso percorso dei messaggi.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppState } from "react-native";
import * as api from "./api";

const KEY = "lat.chaff.v1";
const MEAN = 17000; // intervallo medio ~17 s
const MIN = 6000;
const MAX = 60000;

let enabled = true;
let loaded = false;
let running = false;
let timer = null;

/// Prossimo intervallo casuale (esponenziale, limitato tra MIN e MAX). Puro: testabile.
export function nextDelay(rand = Math.random) {
  const u = Math.min(0.999999, Math.max(1e-6, rand()));
  const d = -MEAN * Math.log(1 - u);
  return Math.round(Math.min(MAX, Math.max(MIN, d)));
}

export async function isEnabled() {
  if (!loaded) {
    try { const v = await AsyncStorage.getItem(KEY); enabled = v == null ? true : v === "1"; } catch { /* default acceso */ }
    loaded = true;
  }
  return enabled;
}

export async function setEnabled(v) {
  enabled = !!v; loaded = true;
  try { await AsyncStorage.setItem(KEY, enabled ? "1" : "0"); } catch { /* niente */ }
  // Sincronizza il servizio nativo (rumore in background, anche a schermo spento).
  try { await require("./wake").applyChaff(); } catch { /* il servizio si riallinea al prossimo avvio */ }
  if (enabled) start(); else stop();
  return enabled;
}

// v2.5.0 — IL PING DI COPERTURA NON GIRA PIU SUL THREAD DELL'INTERFACCIA.
// Prima questo modulo teneva un timer in JS e, a ogni scatto, faceva partire una fetch
// dal thread che disegna lo schermo: una richiesta ogni ~17 s non e' molta, ma cadeva a
// caso, quindi ogni tanto atterrava proprio mentre stavi scorrendo una lista — ed e' cosi
// che nasce un fotogramma perso senza una causa apparente.
// Il ping di copertura lo produce il servizio nativo (`WakeService`, thread `chaffLoop`
// dedicato, processo separato), se Android mantiene attivo il servizio.
// Il timer JS resta solo se il servizio nativo non c'e' (`opts.ping` nei test).
let nativeOnly = true;

/// Solo per i test: rimette il timer in JS.
export function useJsTimer(v) { nativeOnly = !v; }

function tick(ping) {
  if (!running) return;
  if (enabled && AppState.currentState === "active") {
    try { const p = (ping || api.coverPing)(); if (p && p.catch) p.catch(() => {}); } catch { /* silenzioso */ }
  }
  timer = setTimeout(() => tick(ping), nextDelay());
}

export async function start(opts = {}) {
  await isEnabled();
  if (!enabled || running) return;
  running = true;
  // Il servizio nativo si allinea da se leggendo `wake.json` (`applyChaff`).
  if (nativeOnly && !opts.ping) {
    try { await require("./wake").applyChaff(); } catch { /* si riallinea al prossimo avvio */ }
    return;
  }
  timer = setTimeout(() => tick(opts.ping), nextDelay());
}

export function stop() {
  running = false;
  if (timer) { clearTimeout(timer); timer = null; }
}

export function status() { return { running, enabled }; }
