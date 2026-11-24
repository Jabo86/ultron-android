// Padding casuale legacy nell'header X-Pad. Varia la lunghezza dell'header ma non fissa la
// dimensione totale dei pacchetti: non va considerato una protezione contro l'analisi del
// traffico. La copertura completa richiede frame di dimensione fissa sullo stesso percorso.
const CS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

export function randPad(rand = Math.random) {
  const n = 24 + Math.floor(rand() * 1200); // 24…1224 byte
  let s = "";
  for (let i = 0; i < n; i++) s += CS[Math.floor(rand() * CS.length) & 63];
  return s;
}
