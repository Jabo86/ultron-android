# App integration contract for global relays

Status: design gate for the real app path. The current two-node relay probe is not a chat transport.

## Non-negotiable behavior

- A relay forwards opaque, end-to-end-encrypted frames. It never decrypts a chat envelope.
- Relay memory may hold a frame only while forwarding it to an already connected recipient. No mailbox, database, disk queue, push-token store, or per-user delivery history is allowed. If the recipient is offline, the sender keeps the encrypted retry in its local outbox.
- The first relay sees the connecting device's network address and its next relay. The destination relay sees the previous relay and a short-lived recipient route capability. No node should receive the sender's account address or conversation ID.
- TLS is pinned to the node certificate or a trusted certificate chain. Node-to-node requests remain signed and replay-protected. Client authorization must not reuse the account bearer token.
- Existing chats stay on their current transport until the complete online send, receive, retry, deduplication, and receipt path is available. A node health check is never shown as chat delivery.

## Required client and node protocol

1. **Join and trust:** the user imports a signed node invitation containing HTTPS origin, node ID, TLS pin, and supported protocol version. The app checks `/health` and the signed node identity before enabling it. The invitation contains no private node key.
2. **Ephemeral receive route:** while online, the app registers a random, rotating route capability with its chosen node and holds an authenticated streaming connection open. The node keeps the route only in memory and deletes it when the connection closes or expires.
3. **Contact route exchange:** each device sends its current destination-node ID and a one-time route capability to its contact inside an already verified E2EE control envelope. Capabilities rotate and are never published in a global account directory.
4. **Message delivery:** the sender builds the existing recipient E2EE envelope, wraps it in a fixed-size transport frame, and sends it through its entry node. The entry node forwards to the destination node; the destination node writes directly to the recipient's already-open stream, then drops its frame. Signed receipts travel back over the same path. Sender-side retry uses the same message ID and recipient deduplicates locally.
5. **Offline recipient:** no relay buffers the message. The encrypted retry remains on the sender device and is transmitted when the recipient's ephemeral route becomes available. This means no guaranteed background delivery while the sender is offline.

## Cover-traffic contract

The existing `GET /api/health` pings and random `X-Pad` header do not meet this contract. Real and cover traffic must use the same TLS connection, relay endpoint, direction, fixed frame length, and outer envelope schema. Cover payloads are random authenticated ciphertext addressed to rotating decoy routes; the relay must process them through the same forwarding path and discard them at the destination. No visible `isDummy` flag or distinct health endpoint is permitted.

An idle schedule alone cannot hide bursts if real messages are sent immediately between cover frames. To bound that leak, active sessions need a fixed send cadence and a documented maximum delay. Lower cadence improves speed but costs more bandwidth and battery; lower traffic saves resources but leaks more timing. The UI must describe the chosen tradeoff and never promise protection from a global observer able to correlate both ends.

## Current blockers

- `server.mjs` accepts only signed node-to-node test envelopes and returns a receipt; it has no client registration, live recipient stream, or client delivery endpoint.
- The Android app's ordinary chat still sends through `/public/pulse/send` and receives through the current gateway APIs. `relay-node-lab` is not called by `send.js`.
- Current cover pings go to `/api/health`, and `X-Pad` changes header length rather than normalizing frame length.
- The app's account signature is ML-DSA-65; the relay's current test-envelope signature is Ed25519. The production client authorization and key binding must be designed explicitly rather than treating these formats as interchangeable.

Until all of these are implemented and reviewed together, the global node path must remain labeled experimental and must not claim indistinguishable traffic or production chat delivery.
