import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat, writeFile } from "node:fs/promises";
import { ml_dsa65 } from "@noble/post-quantum/ml-dsa.js";

const seed = process.env.ULTRON_MANIFEST_SEED;
if (!/^[a-fA-F0-9]{64}$/.test(seed || "")) throw new Error("Invalid ULTRON manifest signing seed");
const { publicKey, secretKey } = ml_dsa65.keygen(Buffer.from(seed, "hex"));
if (process.argv[2] === "--public-key") {
  process.stdout.write(Buffer.from(publicKey).toString("hex"));
} else {
  const [apk, versionName, versionCodeText] = process.argv.slice(2);
  const versionCode = Number(versionCodeText);
  if (!/^\d+\.\d+\.\d+$/.test(versionName) || !Number.isSafeInteger(versionCode) || versionCode < 184) {
    throw new Error("Invalid ULTRON APK version");
  }
  const url = `https://github.com/Jabo86/ultron-android/releases/download/android-${versionCode}/ULTRON-Messaggi.apk`;
  const digest = createHash("sha256");
  for await (const data of createReadStream(apk)) digest.update(data);
  const sha256 = digest.digest("hex");
  const { size } = await stat(apk);
  const message = Buffer.from(["ultron-apk-v1", versionName, versionCode, url, sha256, size].join("|"));
  const signature = ml_dsa65.sign(message, secretKey);
  if (!ml_dsa65.verify(signature, message, publicKey)) throw new Error("Invalid manifest signature");
  await writeFile("dist/latest.json", JSON.stringify({
    versionName, versionCode, url, sha256, size, sig_alg: "ml-dsa-65", sig: Buffer.from(signature).toString("hex"),
  }) + "\n", { flag: "wx" });
}
