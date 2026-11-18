import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ml_dsa65 } from "@noble/post-quantum/ml-dsa.js";

const jar = process.env.ULTRON_BCPROV_JAR;
if (!jar) throw new Error("Set ULTRON_BCPROV_JAR to the installed Bouncy Castle jar");
const source = readFileSync(new URL(
  "../android/app/src/main/java/com/ultron/messenger/RelayRequestSigner.java", import.meta.url,
), "utf8");
const work = mkdtempSync(join(tmpdir(), "ultron-native-signer-"));
try {
  const harness = join(work, "RelayRequestSigner.java");
  writeFileSync(harness, source.replace(/}\s*$/, `
    public static void main(String[] args) throws Exception {
        java.io.BufferedReader input = new java.io.BufferedReader(new java.io.InputStreamReader(System.in));
        String key = input.readLine();
        System.out.println(sign(input.readLine(), input.readLine(), key));
        System.out.println(sign(input.readLine(), input.readLine(), key));
    }
}
`));
  const keys = ml_dsa65.keygen(randomBytes(32));
  const request = randomBytes(128), requestContext = Buffer.from("ULTRON relay request v1");
  const receipt = randomBytes(140), receiptContext = Buffer.alloc(0);
  const { status, stdout, stderr } = spawnSync("java", ["-cp", jar, harness], {
    input: [keys.secretKey, request, requestContext, receipt, receiptContext].map(bytes =>
      Buffer.from(bytes).toString("hex")).join("\n") + "\n",
    encoding: "utf8",
  });
  assert.equal(status, 0, stderr);
  const [requestSig, receiptSig] = stdout.trim().split("\n").map(hex => Buffer.from(hex, "hex"));
  assert.equal(requestSig.length, 3309);
  assert.equal(receiptSig.length, 3309);
  assert.ok(ml_dsa65.verify(requestSig, request, keys.publicKey, { context: requestContext }));
  assert.ok(ml_dsa65.verify(receiptSig, receipt, keys.publicKey, { context: receiptContext }));
  assert.equal(ml_dsa65.verify(requestSig, request, keys.publicKey, { context: receiptContext }), false);
  console.log("PASS: Java signatures for request and receipt, independent JS verification and context separation.");
} finally {
  rmSync(work, { recursive: true, force: true });
}
