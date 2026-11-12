import { SOFTWARE_LICENSE } from "./softwareLicense";

export const LEGAL_DOCS = [
  { id: "privacy", key: "settings.privacy", path: "/privacy", icon: "shield-checkmark-outline" },
  { id: "terms", key: "settings.terms", path: "/termini", icon: "document-text-outline" },
  { id: "cookies", key: "settings.cookie", path: "/cookie", icon: "cafe-outline" },
  { id: "dpa", key: "settings.dpa", path: "/dpa", icon: "server-outline" },
  { id: "license", key: "settings.eula", path: "/licenza", icon: "ribbon-outline" },
  { id: "acceptable", key: "settings.aup", path: "/uso-accettabile", icon: "checkmark-done-outline" },
  { id: "sla", key: "settings.sla", path: "/sla", icon: "speedometer-outline" },
  { id: "index", key: "settings.legalIndex", path: "/legale", icon: "library-outline" },
];

export const PRIVACY_SUMMARY = {
  it: [
    "Sul telefono vengono conservati il PIN e i campi privati del profilo. Un’esportazione della chiave o del backup crea una copia separata.",
    "Il server può trattare account, chiavi pubbliche, profilo pubblico, buste cifrate dove supportate e dati di consegna. Server e proxy possono vedere IP e orari. Traduzioni, segnalazioni e diagnostica possono inviare dati al servizio.",
    "Il gestore del server deve indicare nell’informativa ufficiale chi tratta i dati, per quali finalità, su quale base e per quanto tempo. Usa i recapiti del gestore per le richieste sui tuoi dati.",
  ],
  en: [
    "The PIN and private profile fields are stored on the phone. Exporting the key or a backup creates a separate copy.",
    "The server may process account data, public keys, public profiles, encrypted envelopes where supported, and delivery data. Servers and proxies can see IP addresses and connection times. Translation, reports and diagnostics may send data to the service.",
    "The server operator's official notice must identify the controller, purposes, legal bases and retention. Use the operator's published contact details for data requests.",
  ],
};

export const DATA_PROTECTION = {
  it: "L’app può cifrare buste e allegati sul dispositivo. La verifica dei contatti aiuta a controllare l’identità del destinatario. Il backup viene cifrato prima di scrivere il file. Modalità di consegna, log e metadati dipendono dalle funzioni e dal server in uso.",
  en: "The app can encrypt envelopes and attachments on the device. Contact verification helps check the recipient’s identity. Backups are encrypted before the file is written. Delivery modes, logs and metadata depend on the features and server in use.",
};

export const CONTACTS_SUMMARY = {
  it: "Cerca per nome o indirizzo nella rubrica. Per aggiungere una persona, usa l’indirizzo completo. La rubrica viene salvata cifrata sul telefono. Durante la sincronizzazione il server può ricevere indirizzi e identificatori necessari alla verifica dei contatti. Alcune regole di consegna dipendono dal server.",
  en: "Search by name or address in Contacts. Use the full address to add someone. The address book is saved encrypted on the phone. During sync the server may receive addresses and identifiers needed to verify contacts. Some delivery rules depend on the server.",
};

const PUBLIC_RULES = {
  it: "Condividi contenuti che hai diritto di pubblicare. Le informazioni pubbliche possono essere lette e copiate. Evita dati privati di terzi, molestie, truffe, spam e file malevoli. Dove disponibili, puoi usare blocco e segnalazione.",
  en: "Share material you have the right to publish. Public information may be read and copied. Avoid disclosing other people's private information, harassment, fraud, spam and malicious files. Use blocking and reporting where available.",
};

export const LEGAL_TEXT = {
  privacy: PRIVACY_SUMMARY,
  terms: {
    it: ["L’app si collega al server selezionato. Il gestore stabilisce le condizioni del servizio, le funzioni disponibili e i canali di assistenza.", PUBLIC_RULES.it, "Consulta i termini ufficiali del gestore per conoscere le condizioni applicabili al tuo servizio."],
    en: ["The app connects to the selected server. Its operator defines service terms, available features and support channels.", PUBLIC_RULES.en, "Read the operator's official terms for the conditions applicable to your service."],
  },
  cookies: {
    it: ["Questa guida riguarda l’app Android. L’app usa memoria locale per preferenze e dati dell’app. Siti esterni e pagine aperte nel browser possono usare cookie secondo le proprie regole.", "Per sapere quali cookie usa il sito del tuo server, consulta l’informativa pubblicata dal gestore."],
    en: ["This guide covers the Android app. The app uses device storage for preferences and app data. External sites and pages opened in a browser may use cookies under their own policies.", "For the server website's cookies, consult the notice published by its operator."],
  },
  dpa: {
    it: ["Un accordo sul trattamento dei dati riguarda il rapporto tra titolare e responsabile quando applicabile. Se usi ULTRON per conto di un’organizzazione, chiedi al gestore l’accordo effettivamente applicabile al servizio."],
    en: ["A data processing agreement concerns the relationship between controller and processor where applicable. If you use ULTRON for an organization, ask the operator for the agreement that applies to the service."],
  },
  license: { it: [SOFTWARE_LICENSE], en: [SOFTWARE_LICENSE] },
  acceptable: { it: [PUBLIC_RULES.it], en: [PUBLIC_RULES.en] },
  sla: {
    it: ["Disponibilità, tempi di intervento e assistenza dipendono dal gestore e dal servizio scelto. Per conoscere gli impegni effettivi, consulta il contratto o lo SLA del gestore."],
    en: ["Availability, response times and support depend on the operator and the chosen service. Consult the operator's contract or SLA for actual commitments."],
  },
};

export function legalServerUrl(base, path) {
  if (typeof base !== "string" || !/^https:\/\/[^/?#@\\\s]+$/i.test(base.replace(/\/+$/, ""))) return null;
  return base.replace(/\/+$/, "") + path;
}
