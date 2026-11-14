import assert from "node:assert/strict";
import { keygen, packMessage, unpackMessage, utf8Encode } from "../src/lib/crypto.js";
import { MAX_KEYFILE_BYTES, openProtectedKeyfile, protectKeyfile } from "../src/lib/keyfileProtection.js";

const pair = keygen();
const keyfile = {
  lns_name: "ultron-test@ultron.uns",
  public_key_hex: pair.publicKeyHex,
  secret_key_hex: pair.secretKeyHex,
  label: "Prova accentata è 😀",
};
const passphrase = "frase di verifica separata 42";
const encrypted = await protectKeyfile(keyfile, passphrase);
const recovery = JSON.parse(JSON.stringify(encrypted));
assert.deepEqual(await openProtectedKeyfile(recovery, passphrase), keyfile);
assert.ok(!JSON.stringify(recovery).includes(keyfile.lns_name));
assert.ok(!JSON.stringify(recovery).includes(keyfile.secret_key_hex));
const second = await protectKeyfile(keyfile, passphrase);
assert.notEqual(second.salt, encrypted.salt);
assert.notEqual(second.iv, encrypted.iv);

await assert.rejects(openProtectedKeyfile(recovery, "wrong passphrase"));
const altered = (recovery.ct[0] === "a" ? "b" : "a") + recovery.ct.slice(1);
await assert.rejects(openProtectedKeyfile({ ...recovery, ct: altered }, passphrase));
await assert.rejects(openProtectedKeyfile({ ...recovery, ct: "a".repeat(MAX_KEYFILE_BYTES + 2) }, passphrase));
await assert.rejects(protectKeyfile(keyfile, "1234"));

for (const text of ["abc", "è".repeat(30), "😀".repeat(30), "\\".repeat(520)]) {
  const message = packMessage(text);
  assert.equal(utf8Encode(message).length % 512, 0);
  assert.equal(unpackMessage(message).text, text);
}

console.log("ULTRON encrypted keyfile and UTF-8 padding checks passed.");
