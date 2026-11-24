# Downloads & verification

Use the project's [GitHub Releases](https://github.com/Jabo86/ultron-android/releases). Do not trust APK files mirrored by unknown parties.

| Channel | Release | Status |
| --- | --- | --- |
| Pilot | [UNVOR Chat Pilot 366](https://github.com/Jabo86/ultron-android/releases/tag/ratchet-pilot-66) | Prerelease; separate test-account app |
| Legacy stable | [ULTRON Messaggi 3.5.20 (218)](https://github.com/Jabo86/ultron-android/releases/tag/android-218) | Existing stable-channel release, legacy branding |
| Launcher | [Development source](https://github.com/Jabo86/ultron-android/tree/fix/unvor-launcher/unvor-launcher) | Signed public APK not verified |

## Integrity

GitHub's release metadata reports this SHA-256 for `UNVOR-Chat-Pilota-366.apk`:

```text
e6349776a8a2c4500c6ef600e3aa214a970ebf3d2eee48aee27a26d370907520
```

On macOS, compute a downloaded file's digest with `shasum -a 256 FILE.apk`; on Linux use `sha256sum FILE.apk`. The digest above was read from metadata, not independently recomputed from the binary. A matching digest does not prove the publisher's identity or security of the application. APK signature checks require Android build tools and comparison against a trusted signing certificate fingerprint; that fingerprint has not been established in this documentation.

Never publish or share a private signing key. A signature mismatch may prevent an update. Do not uninstall an existing installation merely to bypass a mismatch: local data may be lost. Confirm the package identity and backup/recovery arrangements first.

## Publication requirements

Each new release should document its channel, exact source commit, changes, known limitations, test results, supported Android versions, APK digest and signing-certificate fingerprint. See [release checklist](RELEASE-CHECKLIST.md).
