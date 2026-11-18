import { relayPacketDigest, verifyRelayReceipt } from "./volatileRelayTransport.js";

const hex32 = /^[0-9a-f]{32}$/;
const identityKey = /^[0-9a-f]{3904}$/;
const minDelay = 1500;
const maxDelay = 60000;
const entriesLimit = 64;

// The vault provides atomic writes scoped to the current unlocked profile.
// The relay accepting a packet is never treated as recipient delivery.
export function createVolatileRelayOutbox({ prefix, sender, vault, transport, scope, onState = () => {}, clock = Date.now }) {
  if (!hex32.test(sender)) throw new Error("Identità relay non valida.");
  const index = prefix + ":index";
  const key = id => prefix + ":entry:" + id;
  const aborter = new AbortController();
  let disk = Promise.resolve();
  let nextRun;
  let sending = false;
  let wakeRequested = false;
  let online = false;

  const guarded = () => {
    if (aborter.signal.aborted) throw new Error("Coda relay chiusa.");
    scope();
  };
  const run = callback => {
    const result = disk.then(() => { guarded(); return callback(); });
    disk = result.catch(() => {});
    return result;
  };
  const readIds = async () => (await vault.read(index)) ?? [];
  const signalState = (id, status) => {
    guarded();
    onState(id, status);
  };
  function schedule(wait = 0) {
    clearTimeout(nextRun);
    if (!online || aborter.signal.aborted) return;
    if (sending) {
      wakeRequested = true;
      return;
    }
    nextRun = setTimeout(() => { void flush().catch(() => {}); }, wait);
  }

  async function flush() {
    if (sending || !online || aborter.signal.aborted) return;
    sending = true;
    let delay;
    try {
      await run(async () => {
        const ids = await readIds();
        guarded();
        for (const id of ids) {
          if (!online) return;
          const record = await vault.read(key(id));
          guarded();
          if (!record) continue;
          if (record.status === "blocked") continue;
          const left = record.retryAt - clock();
          if (left > 0) { delay = Math.min(delay ?? Infinity, left); continue; }
          return record;
        }
      }).then(async record => {
        if (!record || !online) return;
        guarded();
        let status = "awaiting-receipt";
        try {
          await transport.send(record, aborter.signal);
        } catch (error) {
          status = [400, 409, 413].includes(error?.status) ? "blocked" : "pending";
        }
        await run(async () => {
          const current = await vault.read(key(record.id));
          guarded();
          if (!current || current.digest !== record.digest) return;
          const attempts = Math.min(current.attempts + 1, 8);
          const retryAt = status === "blocked" ? Number.MAX_SAFE_INTEGER :
            clock() + Math.min(maxDelay, minDelay * (2 ** (attempts - 1)));
          await vault.write([[key(record.id), { ...current, retryAt, attempts, status }]]);
          signalState(record.id, status);
        });
        delay = 0;
      });
    } catch (error) {
      delay = minDelay;
      throw error;
    } finally {
      sending = false;
      if (wakeRequested) {
        wakeRequested = false;
        schedule();
      } else if (delay !== undefined && Number.isFinite(delay)) schedule(Math.min(maxDelay, delay));
    }
  }

  return {
    async enqueue({ id, recipient, recipientKey, ciphertext }) {
      if (!hex32.test(id) || !hex32.test(recipient) || !identityKey.test(recipientKey)) throw new Error("Destinazione relay non valida.");
      const digest = relayPacketDigest(ciphertext);
      const status = await run(async () => {
        const ids = await readIds();
        const existing = await vault.read(key(id));
        guarded();
        if (existing) {
          if (existing.digest !== digest || existing.recipient !== recipient || existing.recipientKey !== recipientKey) {
            throw new Error("ID del messaggio relay già usato.");
          }
          return existing.status;
        }
        if (ids.length >= entriesLimit) throw new Error("La coda cifrata contiene troppi messaggi in attesa.");
        const record = { id, sender, recipient, recipientKey, ciphertext, digest, retryAt: clock(), attempts: 0, status: "pending" };
        await vault.write([[key(id), record], [index, [...ids, id]]]);
        return "pending";
      });
      signalState(id, status);
      schedule();
      return id;
    },

    async acceptReceipt(id, signature) {
      if (!hex32.test(id)) return false;
      return run(async () => {
        const record = await vault.read(key(id));
        guarded();
        if (!record || !verifyRelayReceipt(record, signature)) return false;
        const ids = await readIds();
        guarded();
        await vault.write([[key(id), null], [index, ids.filter(entry => entry !== id)]]);
        signalState(id, "delivered");
        return true;
      });
    },

    resume() { guarded(); online = true; schedule(); },
    pause() { online = false; clearTimeout(nextRun); },
    close() { online = false; clearTimeout(nextRun); aborter.abort(); },
  };
}
