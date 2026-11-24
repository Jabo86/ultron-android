# UNVOR stateless relay lab

This is an isolated two-server proof of concept for the UNVOR Android repository. It is **not production-ready and is not wired into the app**.

Before connecting real app traffic, implement and review the client-delivery and cover-traffic contract in [CLIENT_INTEGRATION.md](./CLIENT_INTEGRATION.md). The current health/probe endpoints are not a chat transport, and ordinary conversations still use the existing gateway.

## What the lab checks

- Node A forwards an opaque, client-signed packet to node B over HTTPS.
- Nodes authenticate each other with Ed25519 signatures and pinned TLS certificates.
- The receiving node verifies the packet and returns a signed receipt, then discards it.
- The process has no database, message queue, attachment store, request logger, or filesystem writes. A short-lived in-memory nonce cache prevents replay of node-to-node requests.
- The envelope expires quickly. The lab does not provide offline delivery; the sending app must own any retry queue.

The only intended persistent files in a real deployment are operator configuration, node identity keys, and TLS certificates. The code does not persist user message payloads or per-user delivery metadata. During forwarding, each relay necessarily sees its adjacent peer and transient routing information.

## Limits

The proof endpoint acknowledges receipt at node B; it does not yet connect to UNVOR's client delivery channel, identity directory, message receipts, attachments, push notifications, or settings UI. Do not send real user messages. The payload in tests is random opaque bytes. Public deployment needs a reviewed installer, explicit peer onboarding, abuse controls, monitoring without per-user logs, and integration with the existing Android sender/receiver.

Requires Node.js 22+ and OpenSSL for the local test certificate.

```sh
npm test
```

## Two-server lab setup (after review)

1. Install Docker Engine and the Compose plugin on both test servers. This repository does not run the installer automatically.
2. In this directory on each host, create its own identity and a short-lived TLS certificate:

   ```sh
   sudo bash scripts/bootstrap-node.sh "$PWD/config" PUBLIC_IPV4
   ```

3. Exchange only each node's `identity-public.pem` and `tls-cert.pem`. Never copy `identity-private.pem` or `tls-key.pem` to the other server.
4. Add the other node to each host's local `config/node.json` under `peers`, with the other node ID, `https://OTHER_IPV4:8443`, its public identity key path, and its pinned TLS certificate path.
5. Confirm that TCP 8443 is permitted by the hosting provider firewall, then start the lab with `sudo docker compose up -d --build`.
6. From a trusted machine, run `node scripts/probe-relay.mjs https://SOURCE_IPV4:8443 DESTINATION_NODE_ID SOURCE_TLS_CERT SOURCE_IDENTITY_PUBLIC_KEY`.

This test proves only signed, volatile node-to-node forwarding. It does not send a real UNVOR chat, keep an offline mailbox, notify a background phone, or replace the gateway used by existing builds. Do not use production account keys or real message contents in this lab.
