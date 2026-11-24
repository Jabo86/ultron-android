# Build and verification

## Chat CI

The existing [Android workflow](../.github/workflows/ultron-android-apk.yml) declares Node 22, Java 21, Android API 36, build-tools 36.0.0 and NDK 27.1.12297006. It installs dependencies using the lockfile, audits npm dependencies, runs messaging and notification checks, builds the release APK, and checks the package, embedded bundle and APK signature.

On a development checkout, after reviewing the dependency and build scripts:

```sh
npm ci --legacy-peer-deps --no-fund
node tools/verify-ultron-signed-keys.mjs
node tools/verify-ultron-ratchet.mjs
node tools/verify-ultron-notifications.cjs
```

These checks do not substitute for device testing or an independent audit.

The workflow may create an automatically signed release on `main` if the release signing configuration is available. Other builds can use a test key; their output must not be represented as a stable update. Do not expose signing credentials. See [repro-build.sh](../repro-build.sh) and [apkrepro.py](../tools/apkrepro.py); reproducibility for a given release must be demonstrated, not assumed.

## Launcher

See the separate [launcher source README](https://github.com/Jabo86/ultron-android/blob/fix/unvor-launcher/unvor-launcher/README-SOURCE.md). It identifies required Vosk/JNA and ARM64 dependencies and an offline voice model. Some third-party binary dependencies are not duplicated in that source branch. Follow the documented dependency hashes and existing signing process. Device and watch tests remain required.
