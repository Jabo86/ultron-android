# ULTRON Android

Progetto indipendente ricavato dai sorgenti di Lattice Android.

Repository originale: https://github.com/Jabo86/lattice-android

ULTRON e Lattice sono repository separati. Tutte le modifiche successive a questa importazione vanno applicate **solo** qui.

## Stato
- Base Android React Native + Kotlin importata con i componenti di messaggistica e cifratura esistenti.
- Rimossa l'integrazione diretta Firebase/FCM nella migrazione iniziale.
- Servizio notifiche ULTRON WakeService predisposto per `49.12.242.0`.
- Il server HTTPS e le notifiche end-to-end richiedono ancora verifica funzionale.
- L'APK di debug non rappresenta una release di produzione.

## Build
La pipeline `.github/workflows/ultron-android-apk.yml` compila e controlla le dipendenze. Non inserire chiavi o certificati privati nel repository.
