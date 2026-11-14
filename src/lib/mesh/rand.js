// CASUALITA' CRITTOGRAFICA per la rete mesh.
// Nel mixnet e nella scelta dei relay la casualita' E' sicurezza: chi riesce a prevedere
// `Math.random` puo' provare a indovinare l'ordine dei pacchetti e i relay scelti.
// Qui si usa solo `crypto.getRandomValues`; se non c'e', meglio fermarsi che ripiegare.
function rng() {
  const c = globalThis.crypto;
  if (!c || typeof c.getRandomValues !== "function") throw new Error("Generatore casuale sicuro non disponibile");
  return c;
}

/// Intero uniforme in [0, n), senza distorsione (rifiuto dei valori in eccesso).
export function randInt(n) {
  n = Math.floor(n);
  if (!(n > 0)) return 0;
  if (n > 0xffffffff) throw new Error("randInt: n troppo grande");
  const a = new Uint32Array(1);
  const limit = 0x100000000 - (0x100000000 % n);
  do { rng().getRandomValues(a); } while (a[0] >= limit);
  return a[0] % n;
}

/// Numero in [0, 1) con 53 bit, come Math.random ma imprevedibile.
export function randFloat() {
  const a = new Uint32Array(2);
  rng().getRandomValues(a);
  return ((a[0] >>> 5) * 67108864 + (a[1] >>> 6)) / 9007199254740992;
}

/// Mescola in place (Fisher-Yates con interi uniformi).
export function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
  }
  return arr;
}
