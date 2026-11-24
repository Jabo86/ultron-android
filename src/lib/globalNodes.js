import { requireOptionalNativeModule } from "expo-modules-core";
import { getBlob, setBlobDurably } from "./lock";

const KEY = "global-relay-nodes-v1";
const PROFILE_VERSION = 1;
const NODE_ID = /^[0-9a-f]{64}$/;
const TLS_PIN = /^[0-9a-f]{64}$/;
const native = requireOptionalNativeModule("GlobalRelayHttp");

function normalizeProfile(value) {
  if (!value || value.version !== PROFILE_VERSION || typeof value.url !== "string" ||
      !NODE_ID.test(value.nodeId || "") || !TLS_PIN.test(String(value.tlsSha256 || "").replace(/:/g, "").toLowerCase())) {
    throw new Error("Profilo nodo UNVOR non valido.");
  }
  const url = new URL(value.url);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("Il profilo deve contenere un URL HTTPS senza percorso.");
  }
  if (!Number.isSafeInteger(Number(url.port || 443))) throw new Error("Porta HTTPS non valida.");
  const name = typeof value.name === "string" ? value.name.trim().slice(0, 48) : "";
  return { version: PROFILE_VERSION, name, url: url.origin, nodeId: value.nodeId,
    tlsSha256: String(value.tlsSha256).replace(/:/g, "").toLowerCase() };
}

export async function listGlobalNodes() {
  const stored = await getBlob(KEY);
  if (!Array.isArray(stored)) return [];
  return stored.map(normalizeProfile);
}

export async function addGlobalNode(input) {
  const profile = normalizeProfile(input);
  const current = await listGlobalNodes();
  const next = current.filter(node => node.nodeId !== profile.nodeId).concat(profile).slice(-32);
  await setBlobDurably(KEY, next);
  return next;
}

export async function removeGlobalNode(nodeId) {
  const next = (await listGlobalNodes()).filter(node => node.nodeId !== nodeId);
  await setBlobDurably(KEY, next);
  return next;
}

export async function checkGlobalNode(profile) {
  const node = normalizeProfile(profile);
  if (typeof native?.request !== "function") throw new Error("Client HTTPS con pin TLS non disponibile in questa build Android.");
  const response = await native.request(node.url + "/health", "GET", node.tlsSha256, {}, null);
  let data;
  try { data = JSON.parse(response.body || "{}"); } catch { throw new Error("Il relay non ha restituito JSON valido."); }
  if (response.status !== 200 || data.ok !== true || data.nodeId !== node.nodeId) {
    throw new Error("Risposta del nodo non valida: ID, protocollo o stato non corrispondono.");
  }
  return { ok: true, nodeId: data.nodeId, protocol: data.protocol };
}

export function validateGlobalNodeProfile(value) { return normalizeProfile(value); }
