# ULTRON Android — stato verificabile

| Area | Stato | Evidenza o prova mancante |
| --- | --- | --- |
| Repository e identità Android | IMPLEMENTATA | Repository separato e namespace `com.ultron.messenger` allineato a Gradle, manifest, Telecom, notifiche e modulo AppDisguise. |
| Dipendenze dirette Firebase/FCM ed Expo Notifications | TESTATA | Controllo statico sui sorgenti e sul lockfile. |
| Notifiche ULTRON WakeService | IMPLEMENTATA | Client predisposto per il nodo `https://49.12.242.0`. Restano da provare TLS, registrazione autenticata e consegna in background. |
| Build APK autonoma | IMPLEMENTATA | Pipeline con controllo di firma, package e bundle JavaScript incorporato. Consultare l'esecuzione CI del commit per l'esito della compilazione. |
| Identità, relay e chiamate | IN SVILUPPO | Verificare il backend, la consegna tra due telefoni e il TURN con credenziali temporanee. Configurare i profili amministrativi e il tunnel Reality ULTRON. |
| Aggiornamenti in-app | IN SVILUPPO | Attivazione subordinata alla configurazione della chiave pubblica ULTRON e del manifest firmato. |
| Marchio grafico e testi | IN SVILUPPO | Restano asset e testi ereditati da sostituire. |
