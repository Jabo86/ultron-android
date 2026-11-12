# ULTRON Android

Client di messaggistica Android in React Native con moduli nativi Kotlin e Java. Applicazione e namespace Android `com.ultron.messenger`, schema URI `ultron://`.

## Build di verifica

Il workflow **ULTRON Android APK (verification)** installa le dipendenze dal lockfile, esegue l'audit npm, genera la libreria Xray dal sorgente e compila l'APK con JavaScript incorporato. L'artefatto è `ULTRON-Android-verification.apk`, firmato con una chiave di test generata per la singola esecuzione. Per sostituire un APK firmato con una chiave di test diversa occorre disinstallare la copia precedente, con perdita dei dati locali.

Controllo statico locale:

```sh
node tools/verify-ultron-notifications.cjs
```

## Stato della migrazione

- **IMPLEMENTATA** — Identità Android separata, servizio chiamate e notifiche native ULTRON, nodo predefinito `https://49.12.242.0`.
- **IMPLEMENTATA** — Il feed dei domini malevoli punta al nodo ULTRON. Le tracce degli errori di rendering rimangono sul dispositivo. Gli aggiornamenti in-app restano disattivati finché ULTRON dispone di una propria chiave di firma per il manifest.
- **IN SVILUPPO** — Identità lato server, chiamate via TURN con credenziali temporanee, branding residuo, sostituzione degli asset grafici e integrazione completa con il relay ULTRON.
- **DA VERIFICARE SU DISPOSITIVO** — Installazione, apertura senza Metro, autenticazione, scambio di messaggi tra due telefoni e notifiche ad app in background. Il controllo HTTPS del workflow dedicato è una sonda di raggiungibilità.

## Provenienza

La base iniziale deriva dal ramo `ultron/android-migration` di `Jabo86/lattice-android`, commit `d282fec63b737b1b3d8de521f87b6560e88154a1`. Per attribuzioni e licenze consulta `LICENSE`, `NOTICE`, `TRADEMARK.md` e le licenze dei componenti inclusi.
