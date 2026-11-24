# UNVOR — federazione mondiale di relay senza archiviazione

**Stato:** specifica di avvio; la rete federata non è ancora implementata.  
**Obiettivo:** nodi che inoltrano messaggi in transito e non conservano payload o metadati; nessuna blockchain; l'utente normale non gestisce server.

## 1. Confini del progetto

La mesh locale resta un progetto separato da sviluppare bene. Questa fase riguarda soltanto la rete mondiale di nodi relay; non rimuove né usa la mesh locale come sostituto.

Oggi il client chat usa un gateway predefinito e la federazione mondiale non è attiva. Per passare al modello “solo postino” non basta aggiungere nodi: occorre definire e provare il percorso messaggi, la consegna live e la gestione offline solo sul dispositivo mittente. L'app non deve mostrare la rete come attiva finché due server indipendenti non comunicano davvero.

### Priorità guida: velocità, anonimato e sicurezza

- **Velocità:** mantenere connessioni autenticate riutilizzabili, evitare handshake TLS per ogni messaggio, preferire percorsi brevi e scegliere i peer usando RTT, perdita e carico misurati. La prova deve misurare p50/p95 con entrambi i telefoni online, su tratte vicine e intercontinentali, prima di fissare una promessa di consegna.
- **Anonimato:** identità di nodo pseudonime; mai pubblicare nome del gestore o coordinate precise. Un percorso breve riduce i ritardi ma il relay vede i peer adiacenti; nascondere anche gli IP richiede un overlay multi-hop/onion che può aggiungere latenza. Il protocollo deve ridurre hop e dati osservabili senza promettere anonimato assoluto.
- **Sicurezza:** cifratura end-to-end invariata; autenticazione reciproca dei nodi, certificati/chiavi verificati, replay protection volatile, limiti di connessione e nessuna persistenza di payload o metadati per utente.
- La selezione del percorso misura separatamente latenza e livello di esposizione; non invia contenuti di chat nei probe di prestazione.

## 2. Regola di conservazione: zero persistenza per i messaggi

Un nodo mondiale:

- non scrive su disco, database, log o analytics messaggi, allegati, account, identificativi destinatario, ricevute per utente o cronologia;
- non mantiene cassette postali, code offline, directory utenti o profili;
- usa soltanto memoria volatile per il tempo strettamente necessario a leggere il prossimo hop e inoltrare il pacchetto; il buffer viene eliminato subito dopo l'inoltro o il timeout;
- conserva su disco solo la propria configurazione tecnica e la chiave d'identità del nodo, mai chiavi o dati degli utenti.

L'inoltro non può avvenire senza trattare per un istante dati tecnici di rete. Un relay vede almeno il peer connesso e il traffico in transito; il protocollo deve evitare di salvarli. Instradamento onion, dimensioni fisse e padding possono ridurre ciò che ogni nodo apprende, ma possono aggiungere latenza.

## 3. Come si collegano i nodi di Milano e America

Ogni server ha una chiave d'identità del nodo e un endpoint HTTPS/TLS. I nodi si scoprono attraverso più bootstrap indipendenti, indirizzi QR e liste di peer firmate memorizzate sui client. I bootstrap servono a trovare i primi peer; non archiviano account o messaggi e non sono il percorso obbligatorio dei messaggi.

Dopo la scoperta, i nodi verificano le chiavi, negoziano una versione comune del protocollo e aprono connessioni autenticate persistenti. Ogni relay collega più peer; il routing usa hop brevi e, se un peer cade, prova il percorso disponibile successivo. Per server dietro NAT si usano connessioni in uscita verso peer/relay raggiungibili. Nessun nodo diventa il server principale.

## 4. Indirizzo del contatto e percorso del messaggio

Non avendo una directory utenti server-side, la scheda/QR firmata del contatto deve contenere il suo indirizzo UNVOR e il relay d'ingresso scelto, insieme all'impronta della chiave del relay. La rubrica salva la scheda sul dispositivo. Se una persona cambia relay, distribuisce ai contatti un aggiornamento firmato; i client possono condividere i record firmati tra loro.

Flusso live:

1. Il telefono A cifra il messaggio per B end-to-end e lo conserva localmente nella coda cifrata in uscita.
2. A invia il pacchetto al proprio relay con una rotta a hop firmati/cifrati.
3. Ogni nodo legge soltanto l'informazione volatile necessaria al prossimo passaggio e inoltra il pacchetto, senza registrare chi sta parlando o con chi.
4. Il relay finale consegna a B tramite la connessione attiva del dispositivo.
5. B verifica e mostra il messaggio; la ricevuta torna lungo il percorso. A cancella la copia in uscita dopo la ricevuta finale, secondo la politica locale impostata.

Il nodo non conserva neppure una coda temporanea di messaggi per destinatari offline. Se B è offline, il messaggio resta soltanto sul dispositivo di A e viene ritentato quando A e B possono comunicare. Se A perde o disinstalla il dispositivo prima della consegna, la coda non è recuperabile dai nodi.

### Notifiche

Senza una connessione attiva al dispositivo B, un relay senza storage non può sapere che c'è un messaggio in attesa e svegliare B. Le notifiche di consegna richiedono quindi una connessione live mantenuta dall'app oppure un servizio push separato. Un push provider riceverebbe token e metadati minimi: questa dipendenza deve essere spiegata e resa configurabile, non nascosta dentro ai nodi.

## 5. Uso normale e partecipazione dei clienti

### Chi installa soltanto UNVOR

1. Crea o importa la propria identità nel dispositivo.
2. Lascia **Rete automatica**.
3. L'app prova i nodi disponibili, sceglie il percorso rapido e cambia peer se fallisce.
4. Aggiunge i contatti UNVOR tramite QR/ID e invia messaggi come sempre.
5. Se il destinatario è offline, vede “In attesa che il contatto torni raggiungibile”; l'app conserva la coda cifrata localmente e riprova.

Non deve installare server o conoscere IP e porte.

### Chi vuole contribuire con un nodo

La futura guida in **Impostazioni → Rete mondiale → Contribuisci** deve informare prima dell'attivazione. Il prerequisito previsto è un server Linux/VPS sempre acceso con accesso Internet e endpoint HTTPS. Il wizard ufficiale dovrà:

1. verificare memoria, banda, DNS, TLS, porte e connettività;
2. generare sul server la chiave d'identità del nodo;
3. impostare limiti di connessioni e banda e disabilitare log/persistenza di payload e metadati;
4. verificare il collegamento a più peer indipendenti;
5. creare un QR/record firmato del relay da condividere;
6. mostrare peer attivi, latenza e contatori aggregati, senza statistiche per utente;
7. offrire **Drena connessioni e arresta**, che smette di accettare nuove sessioni e chiude quelle attive.

La configurazione tecnica e la chiave del nodo restano sul server; il relay non diventa un account UNVOR e non riceve chiavi degli utenti. Un telefono resta un client e non viene considerato un relay sempre attivo.

## 6. Informazioni da mostrare nelle Impostazioni

- **Rete automatica** predefinita per gli utenti; nessuna configurazione server.
- Stato dei peer raggiungibili e latenza, senza storico per utente.
- **Contribuisci come relay** con prerequisiti e procedura guidata quando il protocollo è pronto.
- Avviso chiaro: i nodi non archiviano; mittente e destinatario devono essere connessi per la consegna; la coda resta sul dispositivo mittente.
- Nota privacy: i relay non salvano contenuti o log, ma IP, tempi e dimensioni dei pacchetti sono visibili durante il transito a livello di rete; le opzioni onion/padding attenuano questa esposizione a costo di latenza.
- Opzione per disabilitare relay specifici, vedere le chiavi/impronte e passare a **Solo rete privata**.
- **Mappa Home:** mostrare il totale come stima basata su annunci/heartbeat firmati con scadenza breve e deduplicazione per identità di nodo; il riepilogo resta volatile e non contiene utenti o messaggi. Disegnare puntini casuali come visualizzazione astratta, dichiarando chiaramente che non rappresentano posizioni reali. Non mostrare IP, identità stabile del nodo o nome del gestore. Partizioni, nodi offline e identità multiple possono rendere il totale impreciso; non usare la mappa come fonte di routing o prova di affidabilità.
- Dichiarazione sulla dipendenza dal push provider se si vuole ricevere notifiche a app chiusa.

La schermata informativa attualmente in bozza deve riflettere queste regole e restare etichettata **in preparazione**.

## 7. Sicurezza e limiti operativi

- Identità dei nodi autenticate con chiavi e record firmati; TLS obbligatorio; rotazione/revoca chiavi; protocollo versionato.
- Envelope E2EE, deduplicazione e nonce firmati per impedire replay. Qualsiasi cache anti-replay deve essere solo volatile e a scadenza breve.
- Limiti di frame, connessioni, banda e timeout per ridurre denial-of-service; niente log per utente.
- La rete non promette consegna se mittente o destinatario sono offline. Nessun relay può recuperare messaggi dopo l'arresto perché non li ha conservati.
- Un servizio push, se abilitato, è una parte distinta della rete e va documentato come tale.
- Nessuna blockchain o consenso globale: i relay inoltrano pacchetti; le identità e le ricevute sono verificate crittograficamente sui client.

## 8. Marchio UNVOR e compatibilità

Tutti i testi e le superfici visibili agli utenti devono presentare il prodotto come **UNVOR**. I vecchi riferimenti commerciali e di interfaccia vanno censiti e sostituiti con il marchio, i domini e i contatti ufficiali UNVOR.

Non fare una sostituzione automatica delle stringhe interne. I prefissi usati per derivare chiavi, identificatori di storage, formati di backup/QR e nomi dei moduli nativi possono essere necessari per aprire dati esistenti o mantenere l'interfaccia tra JavaScript e Android. Per aggiornarli servono alias di lettura e una migrazione versionata che conservi account, chiavi e cronologia. Le attribuzioni e gli obblighi di licenza vanno verificati e mantenuti; i contatti e i domini legali devono essere aggiornati con valori ufficiali UNVOR prima della pubblicazione.

## 9. Fasi di attivazione e test sul secondo server

1. **Handshake:** avviare un relay di prova sul server attuale e sul secondo server; verificare identità, TLS, versioni e peer reciproci.
2. **Inoltro live:** mantenere A collegato al nodo 1 e B al nodo 2; trasmettere un envelope cifrato Milano↔server remoto↔America.
3. **Stateless check:** controllare filesystem, database e log del relay prima/dopo; nessun payload o metadato per utente deve risultare salvato.
4. **Failover:** spegnere un nodo; provare una rotta alternativa. Se B è offline, verificare che il messaggio resti solo nella coda locale di A e venga ritentato dopo la riconnessione.
5. **Prestazioni e privacy:** misurare p50/p95 di consegna con connessioni riutilizzate, numero di hop, perdita, RAM e banda, separando tratte vicine e intercontinentali e confrontando percorso breve e onion; verificare che i puntini della mappa non siano geolocalizzati e che le statistiche non persistano.
6. **Client:** solo dopo i test precedenti, attivare **Rete automatica** e la guida **Contribuisci come relay** nelle Impostazioni.

**Condizione di rilascio:** non mostrare un comando funzionante per avviare nodi finché l'inoltro live tra server indipendenti e la verifica zero-persistenza non sono stati provati. La mesh locale resta un progetto separato e non viene rimossa in questa fase.
