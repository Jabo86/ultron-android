import { ml_dsa65 } from "@noble/post-quantum/ml-dsa.js";
import { authenticatedScope } from "./api";
import { hexToBytes, sha256Hex } from "./crypto";
import { getBlob, setBlobsDurably } from "./lock";
import { createVolatileRelayOutbox } from "./volatileRelayOutbox";
import { createVolatileRelayTransport } from "./volatileRelayTransport";

export function configureVolatileRelay(user, registration, onState) {
  const scope = authenticatedScope(user);
  const { origin, token, mailbox, installation, secretKey } = registration;
  if (typeof installation !== "string" || !/^[0-9a-f]{32}$/.test(installation) ||
      typeof secretKey !== "string" || !/^[0-9a-f]{8064}$/.test(secretKey)) {
    throw new Error("Chiave di installazione del relay non valida.");
  }
  const sign = async (transcript, context) => {
    await new Promise(resolve => setTimeout(resolve, 0));
    scope();
    const secret = hexToBytes(secretKey);
    try { return ml_dsa65.sign(transcript, secret, { context }); }
    finally { secret.fill(0); }
  };
  const transport = createVolatileRelayTransport({ origin, token, sign });
  const prefix = "relay-outbox:" + sha256Hex(JSON.stringify([user.server, user.lns, origin, installation, mailbox]));
  return {
    transport,
    outbox: createVolatileRelayOutbox({
      prefix, sender: mailbox, vault: { read: getBlob, write: setBlobsDurably }, transport, scope, onState,
    }),
  };
}
