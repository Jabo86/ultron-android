import { analyzeAttachment, analyzeMessage, scanUrl, threatListSize } from "./threatEngine";
import { meshKeypair, meshXKeypair, nodeId, peel, wrap, bytesToHex } from "./mesh/onion";
import { encryptContainer, decryptContainer } from "./backup";

function assert(ok) {
  if (!ok) throw new Error("Audit check failed");
}

export function checkShield() {
  const dangerous = analyzeAttachment({ name: "foto.jpg.exe", mime: "application/octet-stream" });
  assert(dangerous.level === "danger");
  assert(scanUrl("http://192.0.2.1/login").level !== "safe");
  assert(analyzeMessage("https://example.org/", "it").level === "safe");
  return { domains: threatListSize() };
}

export function checkMeshPacket() {
  const payload = new Uint8Array([85, 76, 84, 82, 79, 78]);
  const hops = Array.from({ length: 4 }, (_, index) => {
    const seed = (index + 1).toString(16).padStart(2, "0").repeat(32);
    const kem = meshKeypair(seed);
    const curve = meshXKeypair(seed);
    return { id: nodeId(kem.publicKey), pk: kem.publicKey, sk: kem.secretKey, xpk: curve.publicKey, xsk: curve.secretKey };
  });
  let packet = wrap(hops, payload);
  const altered = packet.slice();
  altered[0] ^= 1;
  let rejected = false;
  try { peel(hops[0], altered); } catch { rejected = true; }
  assert(rejected);
  for (const [index, hop] of hops.entries()) {
    const result = peel(hop, packet);
    if (index === hops.length - 1) {
      assert(result.exit && result.payload.length === payload.length && payload.every((n, i) => result.payload[i] === n));
    } else {
      assert(!result.exit && result.next === bytesToHex(hops[index + 1].id));
      packet = result.packet;
    }
  }
  return { hops: hops.length };
}

export function checkBackupEncryption() {
  const password = "ultron-audit-test-only";
  const payload = { audit: "ultron-backup-round-trip" };
  const encrypted = encryptContainer(payload, password, "password");
  assert(!JSON.stringify(encrypted).includes(payload.audit));
  assert(decryptContainer(encrypted, password).audit === payload.audit);
  let rejected = false;
  try { decryptContainer(encrypted, "wrong-audit-password"); } catch { rejected = true; }
  assert(rejected);
  return true;
}
