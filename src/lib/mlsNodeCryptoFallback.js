// Optional Node fallback of the HPKE package. The mobile engine installs its
// supported WebCrypto methods before loading the HPKE dependency.
export const webcrypto = globalThis.crypto;
