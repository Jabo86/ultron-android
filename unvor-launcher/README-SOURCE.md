# UNVOR Launcher source

Android application identity remains com.ultron.launcher so existing installations can be updated with the same signing key and private agenda. The supplied artwork is used with live controls; CPU/weather are not fabricated.

The prebuilt installer includes the Italian offline Vosk model and ARM64 native dependencies. Those large, unchanged third-party binaries are not duplicated in this source branch. Their original URLs and SHA-256 digests are recorded in DEPENDENCIES.json. A full Gradle rebuild also requires the same Vosk/JNA jars in app/libs, ARM64 .so files in app/src/main/jniLibs/arm64-v8a and model files in app/src/main/assets/voice-it as the previous HUD06 source. Signing uses the existing Mac keystore; no private signing key is included.

The UI workflow verifies control routing, viewport bounds and non-overlap using synthetic test values on 393×852, 360×740 and 412×915. Device and watch tests remain required.
