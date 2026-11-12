// Default server (trial/hosted). Companies with a license run their OWN server:
// the employee points the app to their company server (or the keyfile embeds it).
export const DEFAULT_SERVER = "https://49.12.242.0";
// Compilare dopo il provisioning degli amministratori e del tunnel ULTRON.
export const OWNER_LNS_LIST = [];
export const REALITY_PROFILE = null;

// Chiamate WebRTC: SOLO infrastruttura nostra (coturn sul VPS sovrano). Gli STUN pubblici
// di Google sono stati rimossi: contattarli significherebbe dire a un terzo che stai
// chiamando, e da quale indirizzo. Il media passa dal nostro relay, quindi i due
// interlocutori non vedono mai l'IP l'uno dell'altro.
// Configurare TURN ULTRON con credenziali temporanee emesse dal server; nessuna credenziale statica.
// Non usare credenziali TURN statiche nel client. Configurare TURN ULTRON con credenziali temporanee.
export const ICE_SERVERS = [{ urls: "stun:49.12.242.0:3478" }];

// "relay" = tutto il media passa dal nostro relay: nessuno dei due conosce l'IP dell'altro.
// "all" (solo se l'utente lo chiede) = connessione diretta: più veloce, ma il tuo indirizzo
// diventa visibile all'altra persona.
export function iceConfig(allowDirect) {
  return {
    iceServers: ICE_SERVERS,
    iceTransportPolicy: allowDirect ? "all" : "relay",
    bundlePolicy: "max-bundle",
  };
}
