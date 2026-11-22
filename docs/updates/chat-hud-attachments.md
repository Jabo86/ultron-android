# ULTRON Chat: HUD and encrypted attachment transport

Base: ratchet-pilot-38 (APK 338). Launcher work is out of scope.

## Changes

- Shared black/white/cyan palette, local Orbitron headings and Roboto body fonts.
- Shared native Text/TextInput wrappers retain refs, accessibility and explicit monospace styles.
- Static local HUD background, small panel corner accents, shared helmet artwork on entry and conversation screens. No continuous animation, network font or extra service.
- Android uploads use Expo's native binary upload task with already-encrypted bytes in a private temporary file. HTTP status remains available to session refresh, progress and abort are preserved, and the temporary ciphertext is removed on completion or error.
- Group camera/gallery photos are resized within the gateway's existing limit. Documents and videos retain their bytes.

## Validation

`node tools/verify-ultron-binary-upload.mjs`

`node tools/verify-ultron-contact-badge.cjs`

`node tools/verify-ultron-hosted-ratchet-receive.mjs`

`node tools/verify-ultron-mls-application.mjs`

Production Android Metro export completed locally. Signed APK build must additionally pass the pilot workflow.

## Limits and device acceptance

The user's original attachment failure is not yet reproduced on a physical phone. These changes do not repair a missing gateway route, unavailable database, full disk or server TLS configuration. Record the original HTTP error and test a small PDF, photo, voice note and video in both directions on the signed APK.

Group uploads remain limited to 1 MiB when the managed-group gateway is available, or 96 KiB inline on the older path. Larger group documents/videos require a matching gateway protocol change; the app must not claim otherwise. Individual chats retain their existing chunked upload limit.

Verify small-screen layout, font fallbacks, text scaling, keyboard insets, notifications, profile isolation and existing message history on Pixel and Samsung. Do not uninstall to update. No server persistence or cryptographic anonymity claim is added by this visual/transport change.
