import assert from "node:assert/strict";
import { parseGroupInviteLink, parseGroupInviteDetails, formatGroupInviteLink, displayGroupContacts } from "../src/lib/groupInviteHelpers.js";

const code = "a".repeat(64) + "." + "b".repeat(64);
const founderFp = "c".repeat(64);
const link = formatGroupInviteLink(code, founderFp);
assert.equal(link, "unvor://group-invite/" + code + "~" + founderFp);
assert.equal(parseGroupInviteLink(link), code);
assert.deepEqual(parseGroupInviteDetails(link), { code, founderFingerprint: founderFp });
assert.equal(parseGroupInviteLink("ultron://group-invite/" + code), code);
assert.equal(parseGroupInviteDetails(code).founderFingerprint, null);
assert.equal(parseGroupInviteLink("https://not-unvor.example/" + code), null);
assert.equal(parseGroupInviteLink("unvor://group-invite/" + code + "~" + "g".repeat(64)), null);

const mine = "me@ultron.uns";
const remote = [
  { lns: "alice@ultron.uns", display_name: "Alice Server", mutual: false },
  { lns: "blocked@ultron.uns", blocked: true },
  { lns: mine, display_name: "Mine" },
];
const local = [
  { lns: "alice@ultron.uns", name: "Alice Local" },
  { lns: "bob@ultron.uns", name: "Bob" },
  { lns: "blocked@ultron.uns", name: "Blocked" },
  { lns: "user@gmail.com", name: "not an UNVOR id" },
];
const rows = displayGroupContacts(remote, local, mine);
assert.equal(rows.length, 2);
assert.equal(rows.find(x => x.lns === "alice@ultron.uns").display_name, "Alice Local");
assert.equal(rows.find(x => x.lns === "bob@ultron.uns").display_name, "Bob");
assert.equal(rows.some(x => x.lns === mine), false);
console.log("UNVOR group invite URLs, founder fingerprint and local address book: OK");
