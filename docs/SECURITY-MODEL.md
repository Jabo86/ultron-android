# Security model — draft

## Assets and boundaries

Message content, attachments, identities, device-local keys, contact relationships and release-signing keys require protection. Client devices, operating systems, network connections, relay operators and build infrastructure have distinct trust boundaries.

| Risk | Evidence required before a security claim |
| --- | --- |
| Compromised relay or network | Protocol review, authentication and negative tests; documented metadata exposure |
| Key compromise or rotation | Key lifecycle tests, recovery limits, device replacement behavior |
| Message delays, duplicates, loss | Multi-device delivery, retry, ordering and background-notification tests |
| Supply-chain compromise | Locked dependencies, review, build provenance, signature and reproducibility checks |
| Compromised device | Documented limits of client and operating-system protections |
| Unintended data retention | Storage and logging review, deployment-specific verification |

Existing repository checks cover selected key, ratchet and notification code paths. No independent audit or complete verification of deployed infrastructure is asserted here. A public source repository does not by itself establish security.

Use authorized test environments and test accounts. Report vulnerabilities privately according to [SECURITY.md](../SECURITY.md). Do not publish keys, private conversations, personal identifiers or exploit details in public issues.
