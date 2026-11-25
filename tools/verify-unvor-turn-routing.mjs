import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { turnIceConfig } from "../src/lib/turnIceConfig.js";

assert.throws(() => turnIceConfig({ urls: ["stun:49.12.242.0:3478"], username: "u", credential: "p" }), /TURN/);
assert.throws(() => turnIceConfig({ urls: ["turn:49.12.242.0:3478"] }), /TURN/);
assert.throws(() => turnIceConfig({ urls: ["turn:49.12.242.0:3478"], username: "u" }), /TURN/);
const relay = turnIceConfig({
  urls: ["stun:49.12.242.0:3478", "turn:49.12.242.0:3478?transport=udp", "turns:relay.example:5349"],
  username: "temporary-user", credential: "temporary-secret",
});
assert.equal(relay.iceTransportPolicy, "relay");
assert.equal(relay.bundlePolicy, "max-bundle");
assert.deepEqual(relay.iceServers[0].urls, ["turn:49.12.242.0:3478?transport=udp", "turns:relay.example:5349"]);
assert.equal(relay.iceServers[0].username, "temporary-user");
assert.equal(relay.iceServers[0].credential, "temporary-secret");
const oneToOne = readFileSync(new URL("../src/screens/CallScreen.js", import.meta.url), "utf8");
const group = readFileSync(new URL("../src/screens/GroupCallScreen.js", import.meta.url), "utf8");
assert.match(oneToOne, /if \(!direct\) \{[\s\S]{0,300}api\.callTurn\(\)/);
assert.match(oneToOne, /config = turnIceConfig\(relay\)/);
assert.match(group, /turnConfig\.current = turnIceConfig\(relay\)/);
console.log("UNVOR TURN configuration: mandatory relay credentials and both call paths OK");
