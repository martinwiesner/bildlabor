# Bildlabor

Eine statische Website für GitHub Pages, mit Cloudflare Worker und D1 für sichere OpenAI-Aufrufe und Kurskontingente. Keine Installation auf den Computern der Studierenden nötig.

## Was bereits enthalten ist

- Oberfläche im Stil der bereitgestellten Präsentation: Cremeweiß `#F3F0E8`, Anthrazit `#15171E`, Rostorange `#B83A12`.
- Lokal ausgelieferte Space Grotesk, IBM Plex Sans und JetBrains Mono, einschließlich OFL-Lizenzen. Keine externen Schriftabfragen, kein Tracking, keine JavaScript-Abhängigkeiten.
- Text-zu-Bild und Bearbeitung mit einem Ausgangsbild; PNG/JPG/WebP bis 8 MB.
- Modellauswahl, zwei Qualitätsstufen, drei Bildformate, PNG-Download und Prompt-Download.
- Vergleich mit dem Ausgangsbild, Wiederverwendung eines Ergebnisses und die letzten sechs Ergebnisse im Arbeitsspeicher des Tabs.
- Persönliche, zufällige Zugangscodes mit 128 Bit Entropie, Ablaufdatum, Kontingent pro Code und Gesamtkontingent.
- Einrichtungsassistent unter `docs/setup.html`. Er erstellt Code-Listen, SQL und die öffentliche `config.js` direkt im Browser.

Die Website und der Worker sind vorbereitet, aber noch nicht in deinen Accounts veröffentlicht. `docs/config.js` enthält absichtlich noch keine Worker-Adresse. Kein API-Key ist im Paket enthalten. Die echte Bildgenerierung funktioniert erst nach der folgenden Einrichtung.

## Start ohne Terminal

Du brauchst einen GitHub-Account, einen Cloudflare-Account und einen OpenAI-API-Projekt-Key mit verfügbarem Guthaben und Zugriff auf die verwendeten Bildmodelle. Dafür sind keine Betriebssystem-Adminrechte nötig. In deinem eigenen Repository und Cloudflare-Account benötigst du die entsprechenden Verwaltungsrechte.

### 1. Website auf GitHub bereitstellen

1. ZIP entpacken. Auf GitHub ein Repository `bildlabor` erstellen. Für GitHub Free ein öffentliches Repository verwenden.
2. Über **Add file → Upload files** den Inhalt des Ordners `bildlabor` hochladen. Wichtig: Im Repository muss `docs/index.html` liegen, nicht `bildlabor/docs/index.html`.
3. **Settings → Pages → Build and deployment → Deploy from a branch** wählen.
4. Branch **main**, Ordner **/docs**, dann **Save**.
5. Nach dem Deployment die von GitHub angezeigte URL öffnen, üblicherweise `https://DEIN-NAME.github.io/bildlabor/`.
6. Unten auf **Für Lehrende** klicken. Die Seite führt durch alle verbleibenden Schritte.

GitHub dokumentiert diese Veröffentlichung hier: https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site

### 2. Cloudflare Worker erstellen

1. https://dash.cloudflare.com/ öffnen.
2. **Workers & Pages → Create application**. Einen einfachen Worker erstellen, z. B. über **Hello World**. Name: `bildlabor-api`.
3. **Edit code** öffnen. Den Beispielcode komplett durch den Inhalt von `worker/worker.mjs` ersetzen. Im veröffentlichten Assistenten ist derselbe Code als `worker-source.txt` direkt zum Kopieren verfügbar.
4. **Deploy** anklicken und die `https://….workers.dev`-Adresse notieren.

Die genaue Beschriftung kann sich im Cloudflare-Dashboard ändern. Keine GitHub-Verknüpfung oder lokale CLI ist für diesen Weg nötig.

### 3. Datenbank für die Limits

1. **Storage & databases → D1 SQL Database → Create database**. Name: `bildlabor`.
2. Datenbank öffnen, **Console** wählen und `docs/schema.sql` ausführen. Wenn die Konsole keine mehreren Anweisungen akzeptiert: CREATE-TABLE- und CREATE-INDEX-Anweisungen einzeln ausführen; den gesamten CREATE-TRIGGER-Block einschließlich BEGIN und END gemeinsam ausführen.
3. Zurück zum Worker: **Bindings → Add binding → D1 database**.
4. Variablenname exakt **DB**; Datenbank **bildlabor** auswählen. Speichern und deployen.

Quelle: https://developers.cloudflare.com/d1/get-started/

### 4. Geheimen Schlüssel eintragen

Worker → **Settings → Variables and Secrets**:

| Typ | Name | Wert |
| --- | --- | --- |
| Secret | `OPENAI_API_KEY` | Dein OpenAI-Projekt-Key |
| Text | `ALLOWED_ORIGIN` | `https://DEIN-NAME.github.io` |

Bei `ALLOWED_ORIGIN` keinen Repository-Pfad und keinen abschließenden `/` eintragen. Anschließend speichern und deployen. Den API-Key nie in GitHub, in `config.js`, in Kurscodes oder im Chat eintragen.

Quelle: https://developers.cloudflare.com/workers/configuration/secrets/

### 5. Kurscodes aktivieren

1. Auf deiner GitHub-Seite **Für Lehrende → Kurscodes** öffnen.
2. Kursname, Codeanzahl, Versuche pro Code, Gesamtkontingent und Ablaufdatum eintragen. Standardvorschlag: 30 Codes × 5 Versuche = 150 Starts insgesamt. Zum ersten Test besser klein beginnen.
3. **Kurscodes vorbereiten** anklicken. Die Code-Liste herunterladen und privat aufbewahren. Keine Code-Datei in GitHub hochladen.
4. Das erzeugte SQL in der **D1 Console** ausführen. Bei Bedarf die Anweisungen einzeln ausführen. Erst danach sind die Codes gültig.
5. Jede Person erhält einen eigenen Code. Wer einen Code kennt, kann dessen Kontingent nutzen; es gibt keine Bindung an eine Person oder einen bestimmten Rechner.

Der Assistent speichert seine Code-Liste nicht. Sie ist nach dem Schließen nicht wiederherstellbar. Er ist öffentlich erreichbar, kann aber ohne deinen Cloudflare-Account keine Codes aktivieren oder Kontingente ändern.

### 6. Website und Worker verbinden

1. Im Assistenten die `https://….workers.dev`-Adresse eingeben.
2. **config.js herunterladen**. Im GitHub-Repository `docs/config.js` durch diese Datei ersetzen und committen.
3. GitHub-Deployment abwarten und die Seite neu laden.
4. Auf der veröffentlichten Seite **Verbindung prüfen** ausführen. Diese Prüfung zeigt nur, ob der Worker erreichbar ist und die Bindings/Variablen vorhanden sind.
5. Im Labor mit einem Testcode anmelden. Ein Textbild und anschließend ein Bild mit Referenz erzeugen. Erst diese Tests bestätigen den Zugriff auf Datenbank und OpenAI-Modelle in deinem Account.

Die CORS-Freigabe gilt für den eingetragenen Origin. Eine andere Domain oder lokale Vorschau wird absichtlich abgelehnt. Für eigene Domains müssten `ALLOWED_ORIGIN`, die URL-Prüfung in `app.js`/`setup.js` und die CSP-Einträge der HTML-Dateien angepasst werden. Die ausgelieferte Version ist auf `workers.dev` ausgelegt.

## Kurs pausieren und Nutzung prüfen

In der D1 Console:

```sql
-- Keine neuen Generierungen erlauben:
UPDATE campaign SET enabled = 0 WHERE id = 1;

-- Wieder öffnen:
UPDATE campaign SET enabled = 1 WHERE id = 1;

-- Verbrauch:
SELECT label, used, quota, datetime(expires_at, 'unixepoch') AS expires_utc FROM codes;
SELECT used, total_limit, enabled FROM campaign;

-- Einen Code sperren; das tatsächliche Label aus der Code-Liste einsetzen:
UPDATE codes SET enabled = 0 WHERE label = 'DEIN-CODE-LABEL';
```

Schon laufende OpenAI-Anfragen können noch abgeschlossen werden. Für einen neuen Kurs eine neue Datenbank anlegen oder die vorhandenen Daten bewusst verwalten. Nicht während laufender Anfragen Zähler zurücksetzen oder Anfrage-IDs löschen.

## Wie die Kostenkontrolle funktioniert

- Die Limits werden im Worker und in D1 geprüft. Änderungen am Browser oder direkte API-Anfragen umgehen sie nicht.
- Eine atomare SQL-Anweisung reserviert einen Versuch; ein Trigger erhöht Code- und Kurszähler in derselben Datenbankoperation. Mehrere gleichzeitige Anfragen können dadurch die Limits nicht überschreiten.
- Pro Code ist nur eine ausstehende Anfrage erlaubt. Eine hängengebliebene Reservierung blockiert weitere Starts für vier Minuten; verbrauchte Versuche bleiben gezählt.
- Jede Anfrage hat eine eindeutige UUID. Dieselbe UUID wird nicht erneut an OpenAI geschickt. Es gibt keine automatischen kostenpflichtigen Wiederholungen.
- Ein gestarteter OpenAI-Versuch zählt auch bei Fehler oder Verbindungsabbruch. Unbekannte Kosten werden nicht automatisch zurückerstattet. Eingabefehler, abgelaufene Codes und gesperrte Zugänge werden vor dem Start abgelehnt.
- Erlaubt sind ausschließlich die Modelle aus `MODELS` in `worker.mjs`, `low`/`medium`, die drei festen Bildgrößen und genau ein Ergebnis. Keine frei wählbaren OpenAI-Endpunkte oder URLs für Eingabebilder.
- Dies begrenzt die Anzahl von Versuchen, nicht einen festen Eurobetrag. Preise variieren nach Modell, Ausgabe und Bildinput. API- und gegebenenfalls Cloudflare-Kosten fallen in deinen Accounts an. Prüfe Guthaben und Abrechnung vor dem Kurs.

## Datenschutz und Rechnerwechsel

Kurscodes, Prompts, hochgeladene Bilder und Ergebnisse werden von der Oberfläche nur im Arbeitsspeicher gehalten. Es gibt weder Local Storage noch Cookies oder Tracking. **Abmelden & löschen** räumt die Sitzung auf; Heruntergeladenes liegt weiterhin im Downloadordner des Pool-Rechners. Browser können Passwörter unabhängig von der Website speichern; angebotene Passwortspeicherung im Pool ablehnen.

D1 speichert Code-Hashes, Labels, Ablaufdatum, Zähler und Anfrage-ID/Zeit/Status. Bilder und Prompts werden nicht in D1 abgelegt. Zur Generierung durchlaufen sie Cloudflare und werden an OpenAI übertragen; deren Verarbeitung/Retention hängt von deinen Accounts und Einstellungen ab. Die Software behauptet keine vollständige Löschung bei diesen Anbietern. Der Worker schreibt keine Prompt-, Bild- oder Key-Inhalte in Logs und gibt keine rohen OpenAI-Fehler an Besucher aus.

## Entwicklung und Prüfung

Keine Build-Schritte und keine npm-Pakete nötig. Optional für Entwickler: statischen Server auf `docs/` starten. Die Quota- und API-Tests benötigen Node.js 24 oder neuer:

```sh
node --test tests/worker.test.mjs
```

Geprüft: 12 Tests mit echtem lokalem SQLite und simulierten OpenAI-Antworten, einschließlich persönlichem/globalem Kontingent, konkurrierenden Aufrufen, Duplikaten, Ablauf, Sperre, CORS, Referenzbild-Routing, Eingabegrenzen und Fehlerfällen. Syntaxprüfungen bestanden. Die Oberfläche, Beispielprompts und Code-Erstellung wurden im Browser geprüft. Keine echte OpenAI-Generierung oder Cloudflare-Veröffentlichung wurde ausgeführt; dafür fehlen noch deine Account-Einrichtung und dein API-Key.

Die API-Anbindung folgt der offiziellen Dokumentation:

- https://developers.openai.com/api/reference/resources/images/methods/generate
- https://developers.openai.com/api/reference/resources/images/methods/edit
- https://developers.openai.com/api/reference/overview

Wenn du den Worker änderst, aktualisiere auch die zum Kopieren bereitgestellte Datei `docs/worker-source.txt`.
