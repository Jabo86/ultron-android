// Plaintext limit. Encrypted transfers add an authentication tag per chunk.
export const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024;
export const ATTACHMENT_CHUNK_BYTES = 4 * 1024 * 1024;
