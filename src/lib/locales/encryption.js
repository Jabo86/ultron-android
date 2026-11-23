// User-facing encryption descriptions, shared by home, chats and calls.
const rows = {
 it: [
  "UNVOR è la tua app per messaggi, gruppi e chiamate. Con la cifratura end-to-end (E2EE), messaggi e allegati vengono cifrati sul telefono e decifrati sui dispositivi dei partecipanti.",
  "Messaggi e allegati con cifratura end-to-end", "Chiamata con cifratura end-to-end",
  "Messaggi e allegati vengono cifrati sul telefono e decifrati sui dispositivi dei partecipanti. Il gateway inoltra contenuti cifrati. Verifica le chiavi con lo scudo della chat. E2EE non rende anonimi i metadati.",
  "Nei gruppi MLS, messaggi e allegati vengono cifrati sui dispositivi e aperti dai membri autorizzati. E2EE non nasconde da sola i metadati e non impedisce ai partecipanti di conservare copie.",
  "WebRTC cifra l’audio tra i telefoni con DTLS-SRTP. Il relay TURN inoltra audio cifrato ma vede gli IP. Confrontate le emoji di sicurezza per verificare la chiamata.",
  "Questa chiamata usa connessioni WebRTC cifrate con DTLS-SRTP tra i dispositivi. Il relay inoltra flussi cifrati ma vede gli IP. Cifratura e verifica dell’identità dei partecipanti sono controlli distinti.", "Ho capito"
 ],
 en: [
  "UNVOR connects you through messages, groups and calls. With end-to-end encryption (E2EE), messages and attachments are encrypted on the phone and decrypted on participants’ devices.",
  "End-to-end encrypted messages and attachments", "End-to-end encrypted call",
  "Messages and attachments are encrypted on the phone and decrypted on participants’ devices. The gateway forwards encrypted content. Verify keys using the chat shield. E2EE does not make metadata anonymous.",
  "In MLS groups, messages and attachments are encrypted on devices and opened by authorized members. E2EE alone does not hide metadata or prevent participants from keeping copies.",
  "WebRTC encrypts audio between phones using DTLS-SRTP. The TURN relay forwards encrypted audio but sees IP addresses. Compare security emojis to verify the call.",
  "This call uses WebRTC connections encrypted with DTLS-SRTP between devices. The relay forwards encrypted streams but sees IP addresses. Encryption and verification of participants’ identities are separate checks.", "Got it"
 ],
 fr: [
  "UNVOR est votre application de messages, groupes et appels. Le chiffrement de bout en bout (E2EE) chiffre les messages et pièces jointes sur le téléphone et les déchiffre sur les appareils des participants.",
  "Messages et pièces jointes chiffrés de bout en bout", "Appel chiffré de bout en bout",
  "Les messages et pièces jointes sont chiffrés sur le téléphone et déchiffrés sur les appareils des participants. La passerelle relaie des contenus chiffrés. Vérifiez les clés avec le bouclier du chat. E2EE ne rend pas les métadonnées anonymes.",
  "Dans les groupes MLS, les messages et pièces jointes sont chiffrés sur les appareils et ouverts par les membres autorisés. E2EE ne masque pas à lui seul les métadonnées et n’empêche pas de conserver des copies.",
  "WebRTC chiffre l’audio entre téléphones avec DTLS-SRTP. Le relais TURN transmet l’audio chiffré mais voit les adresses IP. Comparez les émojis de sécurité pour vérifier l’appel.",
  "Cet appel utilise des connexions WebRTC chiffrées avec DTLS-SRTP entre appareils. Le relais transmet des flux chiffrés mais voit les adresses IP. Chiffrement et vérification de l’identité sont des contrôles distincts.", "Compris"
 ],
 de: [
  "UNVOR ist deine App für Nachrichten, Gruppen und Anrufe. Ende-zu-Ende-Verschlüsselung (E2EE) verschlüsselt Nachrichten und Anhänge auf dem Telefon und entschlüsselt sie auf den Geräten der Beteiligten.",
  "Ende-zu-Ende-verschlüsselte Nachrichten und Anhänge", "Ende-zu-Ende-verschlüsselter Anruf",
  "Nachrichten und Anhänge werden auf dem Telefon verschlüsselt und auf den Geräten der Beteiligten entschlüsselt. Das Gateway leitet verschlüsselte Inhalte weiter. Prüfe Schlüssel über das Chat-Schild. E2EE anonymisiert keine Metadaten.",
  "In MLS-Gruppen werden Nachrichten und Anhänge auf den Geräten verschlüsselt und von berechtigten Mitgliedern geöffnet. E2EE allein verbirgt keine Metadaten und verhindert nicht, dass Beteiligte Kopien behalten.",
  "WebRTC verschlüsselt Audio zwischen Telefonen mit DTLS-SRTP. Das TURN-Relay leitet verschlüsseltes Audio weiter, sieht aber IP-Adressen. Vergleicht die Sicherheits-Emojis, um den Anruf zu prüfen.",
  "Dieser Anruf nutzt mit DTLS-SRTP verschlüsselte WebRTC-Verbindungen zwischen Geräten. Das Relay leitet verschlüsselte Datenströme weiter, sieht aber IP-Adressen. Verschlüsselung und Identitätsprüfung sind getrennte Kontrollen.", "Verstanden"
 ],
 es: [
  "UNVOR es tu aplicación de mensajes, grupos y llamadas. Con el cifrado de extremo a extremo (E2EE), los mensajes y archivos adjuntos se cifran en el teléfono y se descifran en los dispositivos de los participantes.",
  "Mensajes y archivos cifrados de extremo a extremo", "Llamada cifrada de extremo a extremo",
  "Los mensajes y archivos se cifran en el teléfono y se descifran en los dispositivos de los participantes. El gateway transmite contenido cifrado. Verifica las claves con el escudo del chat. E2EE no anonimiza los metadatos.",
  "En los grupos MLS, los mensajes y archivos se cifran en los dispositivos y los abren los miembros autorizados. E2EE por sí solo no oculta los metadatos ni impide que los participantes guarden copias.",
  "WebRTC cifra el audio entre teléfonos con DTLS-SRTP. El relay TURN transmite audio cifrado, pero ve las direcciones IP. Comparad los emojis de seguridad para verificar la llamada.",
  "Esta llamada usa conexiones WebRTC cifradas con DTLS-SRTP entre dispositivos. El relay transmite flujos cifrados, pero ve las direcciones IP. El cifrado y la verificación de identidad son controles distintos.", "Entendido"
 ],
 pt: [
  "UNVOR é seu aplicativo de mensagens, grupos e chamadas. Com a criptografia de ponta a ponta (E2EE), mensagens e anexos são criptografados no telefone e descriptografados nos dispositivos dos participantes.",
  "Mensagens e anexos com criptografia de ponta a ponta", "Chamada com criptografia de ponta a ponta",
  "Mensagens e anexos são criptografados no telefone e descriptografados nos dispositivos dos participantes. O gateway encaminha conteúdo criptografado. Verifique as chaves pelo escudo da conversa. E2EE não torna os metadados anônimos.",
  "Nos grupos MLS, mensagens e anexos são criptografados nos dispositivos e abertos pelos membros autorizados. E2EE por si só não oculta metadados nem impede os participantes de guardar cópias.",
  "WebRTC criptografa o áudio entre telefones com DTLS-SRTP. O relay TURN encaminha áudio criptografado, mas vê os endereços IP. Comparem os emojis de segurança para verificar a chamada.",
  "Esta chamada usa conexões WebRTC criptografadas com DTLS-SRTP entre dispositivos. O relay encaminha fluxos criptografados, mas vê os endereços IP. Criptografia e verificação de identidade são controles distintos.", "Entendi"
 ],
 ru: [
  "UNVOR — приложение для сообщений, групп и звонков. Сквозное шифрование (E2EE) шифрует сообщения и вложения на телефоне и расшифровывает их на устройствах участников.",
  "Сообщения и вложения со сквозным шифрованием", "Звонок со сквозным шифрованием",
  "Сообщения и вложения шифруются на телефоне и расшифровываются на устройствах участников. Шлюз передаёт зашифрованные данные. Проверяйте ключи через значок щита в чате. E2EE не делает метаданные анонимными.",
  "В группах MLS сообщения и вложения шифруются на устройствах и открываются уполномоченными участниками. Само E2EE не скрывает метаданные и не мешает участникам сохранять копии.",
  "WebRTC шифрует звук между телефонами с помощью DTLS-SRTP. Ретранслятор TURN передаёт зашифрованный звук, но видит IP-адреса. Сравните защитные эмодзи для проверки звонка.",
  "Этот звонок использует зашифрованные DTLS-SRTP соединения WebRTC между устройствами. Ретранслятор передаёт зашифрованные потоки, но видит IP-адреса. Шифрование и проверка личности — разные проверки.", "Понятно"
 ],
 ar: [
  "UNVOR تطبيقك للرسائل والمجموعات والمكالمات. باستخدام التشفير التام بين الطرفين (E2EE)، تُشفّر الرسائل والمرفقات على الهاتف ويُفك تشفيرها على أجهزة المشاركين.",
  "رسائل ومرفقات مشفّرة تمامًا بين الطرفين", "مكالمة مشفّرة تمامًا بين الطرفين",
  "تُشفّر الرسائل والمرفقات على الهاتف ويُفك تشفيرها على أجهزة المشاركين. تمرّر البوابة محتوى مشفّرًا. تحقّق من المفاتيح عبر درع المحادثة. لا يجعل E2EE البيانات الوصفية مجهولة الهوية.",
  "في مجموعات MLS، تُشفّر الرسائل والمرفقات على الأجهزة ويفتحها الأعضاء المصرّح لهم. لا يخفي E2EE وحده البيانات الوصفية ولا يمنع المشاركين من الاحتفاظ بنسخ.",
  "يشفّر WebRTC الصوت بين الهواتف باستخدام DTLS-SRTP. يمرّر وسيط TURN الصوت المشفّر، لكنه يرى عناوين IP. قارنوا رموز الأمان التعبيرية للتحقّق من المكالمة.",
  "تستخدم هذه المكالمة اتصالات WebRTC مشفّرة باستخدام DTLS-SRTP بين الأجهزة. يمرّر الوسيط تدفقات مشفّرة، لكنه يرى عناوين IP. التشفير والتحقّق من هوية المشاركين فحصان منفصلان.", "فهمت"
 ],
 zh: [
  "UNVOR 是用于消息、群组和通话的应用。通过端到端加密（E2EE），消息和附件在手机上加密，并在参与者的设备上解密。",
  "消息和附件采用端到端加密", "端到端加密通话",
  "消息和附件在手机上加密，在参与者的设备上解密。网关转发加密内容。请通过聊天中的盾牌图标验证密钥。E2EE 不会使元数据匿名。",
  "在 MLS 群组中，消息和附件在设备上加密，由获授权成员打开。仅靠 E2EE 无法隐藏元数据，也无法阻止参与者保留副本。",
  "WebRTC 使用 DTLS-SRTP 加密手机之间的音频。TURN 中继转发加密音频，但能看到 IP 地址。请比较安全表情符号以验证通话。",
  "此通话使用设备之间经 DTLS-SRTP 加密的 WebRTC 连接。中继转发加密数据流，但能看到 IP 地址。加密和参与者身份验证是不同的检查。", "明白了"
 ],
 ja: [
  "UNVOR はメッセージ、グループ、通話のためのアプリです。エンドツーエンド暗号化（E2EE）により、メッセージと添付ファイルは電話で暗号化され、参加者の端末で復号されます。",
  "メッセージと添付ファイルはエンドツーエンド暗号化", "エンドツーエンド暗号化された通話",
  "メッセージと添付ファイルは電話で暗号化され、参加者の端末で復号されます。ゲートウェイは暗号化された内容を転送します。チャットの盾アイコンで鍵を確認してください。E2EE はメタデータを匿名化しません。",
  "MLS グループでは、メッセージと添付ファイルは端末で暗号化され、許可されたメンバーが開きます。E2EE だけではメタデータを隠したり、参加者によるコピーの保存を防いだりできません。",
  "WebRTC は DTLS-SRTP で電話間の音声を暗号化します。TURN リレーは暗号化された音声を転送しますが、IP アドレスは確認できます。通話の確認にはセキュリティ絵文字を比較してください。",
  "この通話は端末間で DTLS-SRTP により暗号化された WebRTC 接続を使います。リレーは暗号化ストリームを転送しますが、IP アドレスは確認できます。暗号化と参加者の本人確認は別の確認です。", "わかりました"
 ],
 tr: [
  "UNVOR mesajlar, gruplar ve aramalar için uygulamandır. Uçtan uca şifreleme (E2EE) ile mesajlar ve ekler telefonda şifrelenir, katılımcıların cihazlarında çözülür.",
  "Uçtan uca şifrelenmiş mesajlar ve ekler", "Uçtan uca şifrelenmiş arama",
  "Mesajlar ve ekler telefonda şifrelenir ve katılımcıların cihazlarında çözülür. Ağ geçidi şifreli içerikleri iletir. Anahtarları sohbet kalkanıyla doğrula. E2EE meta verileri anonim yapmaz.",
  "MLS gruplarında mesajlar ve ekler cihazlarda şifrelenir ve yetkili üyelerce açılır. E2EE tek başına meta verileri gizlemez veya katılımcıların kopya saklamasını engellemez.",
  "WebRTC, telefonlar arasındaki sesi DTLS-SRTP ile şifreler. TURN aktarıcısı şifreli sesi iletir ancak IP adreslerini görür. Aramayı doğrulamak için güvenlik emojilerini karşılaştırın.",
  "Bu arama, cihazlar arasında DTLS-SRTP ile şifrelenmiş WebRTC bağlantıları kullanır. Aktarıcı şifreli akışları iletir ancak IP adreslerini görür. Şifreleme ve kimlik doğrulama ayrı kontrollerdir.", "Anladım"
 ],
 hi: [
  "UNVOR संदेशों, समूहों और कॉल के लिए आपका ऐप है। एंड-टू-एंड एन्क्रिप्शन (E2EE) से संदेश और अटैचमेंट फ़ोन पर एन्क्रिप्ट होते हैं और प्रतिभागियों के डिवाइस पर डिक्रिप्ट होते हैं।",
  "एंड-टू-एंड एन्क्रिप्टेड संदेश और अटैचमेंट", "एंड-टू-एंड एन्क्रिप्टेड कॉल",
  "संदेश और अटैचमेंट फ़ोन पर एन्क्रिप्ट होते हैं और प्रतिभागियों के डिवाइस पर डिक्रिप्ट होते हैं। गेटवे एन्क्रिप्टेड सामग्री आगे भेजता है। चैट के शील्ड से कुंजियाँ सत्यापित करें। E2EE मेटाडेटा को गुमनाम नहीं बनाता।",
  "MLS समूहों में संदेश और अटैचमेंट डिवाइस पर एन्क्रिप्ट होते हैं और अधिकृत सदस्य उन्हें खोलते हैं। अकेला E2EE मेटाडेटा नहीं छिपाता और प्रतिभागियों को प्रतियाँ रखने से नहीं रोकता।",
  "WebRTC, DTLS-SRTP से फ़ोन के बीच ऑडियो एन्क्रिप्ट करता है। TURN रिले एन्क्रिप्टेड ऑडियो आगे भेजता है, लेकिन IP पते देखता है। कॉल सत्यापित करने के लिए सुरक्षा इमोजी मिलाएँ।",
  "यह कॉल डिवाइस के बीच DTLS-SRTP से एन्क्रिप्टेड WebRTC कनेक्शन इस्तेमाल करती है। रिले एन्क्रिप्टेड स्ट्रीम आगे भेजता है, लेकिन IP पते देखता है। एन्क्रिप्शन और प्रतिभागियों की पहचान का सत्यापन अलग जाँच हैं।", "समझ गया"
 ]
};
const keys = ["unvor.intro", "encryption.chat", "encryption.call", "encryption.chatInfo", "encryption.groupInfo", "encryption.callInfo", "encryption.groupCallInfo", "encryption.close"];
export const ENCRYPTION_KEYS = Object.fromEntries(Object.entries(rows).map(([code, values])=>[code,Object.fromEntries(keys.map((key,index)=>[key,values[index]]))]));
