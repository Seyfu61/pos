# Kasse – Pizza Haus & mehr

Kasse (POS) als Web-App für das iPad, mit Bondruck auf dem **Star mC-Print3**.
Reines HTML/CSS/JavaScript ohne Build-Schritt und ohne Server – alle Daten liegen auf dem Gerät.

## Was die Kasse kann

- **Kasse**: Artikel antippen oder Artikelnummer über das eingebaute **Nummernfeld** eintippen (z. B. `220`,
  „Hinzufügen“) – die iPad-Tastatur bleibt dabei zu. Größen und Extras wählen,
  Notiz für die Küche, Lieferung oder Abholung, Lieferkosten (1,80 / 2,50 / 3,50 € oder freier Betrag),
  Bar- oder Kartenzahlung.
- **Speisekarte**: 163 Artikel in 14 Kategorien, importiert von
  [bringstar.jetzt](https://bringstar.jetzt/rosdorf/pizza-haus-mehr-obernjesa/lieferservice) – mit den dortigen
  Artikelnummern, Größen und Preisen; Tippfehler der Quelle werden beim Import korrigiert
  (Liste in `tools/fetch-menu.mjs`). In den Einstellungen bearbeitbar.
- **Kunden**: Suche nach Telefonnummer, Name oder Straße; Anlegen direkt an der Kasse; **CSV-Import** mit Spaltenzuordnung.
- **Bons**: Küchenbons getrennt für **Pizzaseite** und **Küchenseite** (groß, ohne Preise; darunter klein, was die
  jeweils andere Seite für dieselbe Bestellung macht) und Kundenbon (mit Adresse, MwSt.-Ausweis, standardmäßig 2×).
  Welche Kategorie auf welchem Küchenbon steht, lässt sich je Kategorie einstellen. Nachdruck, Storno, Tagesbericht.
  Bei Lieferungen steht auf dem Kundenbon ein **QR-Code**, der in Google Maps die Route zur Lieferadresse öffnet.
- **Offline**: als App auf dem Home-Bildschirm installierbar, läuft auch ohne Internet.

## Auf dem iPad einrichten

Die Kasse besteht nur aus statischen Dateien und kann überall liegen, wo ein Webserver sie ausliefert.

**Variante A – im Internet (z. B. GitHub Pages)**
Im Repository unter *Settings › Pages* „Deploy from a branch“ wählen, Branch und Ordner `/ (root)` einstellen.
Die Kasse ist dann unter `https://<benutzer>.github.io/pos/` erreichbar. (Bei privaten Repositories ist dafür ein
kostenpflichtiger GitHub-Tarif nötig; jeder andere Webspace funktioniert genauso.)

**Variante B – im eigenen Netz**
Auf einem Rechner im Laden `node tools/serve.mjs` starten und auf dem iPad die angezeigte Adresse öffnen
(`http://<IP>:8080`). Offline-Betrieb gibt es auf diesem Weg nicht, der Rechner muss laufen.

Danach in Safari **Teilen › Zum Home-Bildschirm** – die Kasse startet dann im Vollbild, und das iPad löscht die
gespeicherten Daten nicht automatisch.

## Drucker anschließen (Star mC-Print3)

Einstellungen › Drucker. Der Bon wird als Bild in Druckerauflösung (576 Punkte, 80 mm) gesendet – Umlaute und
€-Zeichen stimmen dadurch unabhängig von Zeichensatz-Einstellungen. Es gibt drei Wege:

| Anschlussart | Wann | Hinweise |
| --- | --- | --- |
| **Star webPRNT Browser App** | Kasse läuft über `https://` (Variante A); Drucker per Bluetooth, USB oder LAN | Kostenlose App von Star aus dem App Store. In der iPad-App „Einstellungen“ › „Star webPRNT“ den Drucker wählen und bei *HOME URL* die Adresse der Kasse eintragen. Die Kasse wird dann in dieser App geöffnet. |
| **Star WebPRNT – Netzwerk** | Kasse läuft über `http://` (Variante B); Drucker im LAN/WLAN | IP-Adresse des Druckers eintragen. Läuft die Kasse über `https://`, blockiert Safari die unverschlüsselte Verbindung – dann entweder HTTPS am Drucker aktivieren und dessen Zertifikat auf dem iPad installieren oder die App oben verwenden. |
| **AirPrint** | Notlösung | Es erscheint jedes Mal der Druckdialog des iPads; keine Kassenschublade. |

Über „Testdruck“ lässt sich die Verbindung prüfen. Die Kassenschublade (am Drucker angeschlossen) kann bei
Barzahlung automatisch geöffnet werden.

> **Stand:** Das Druckprotokoll ist nach dem offiziellen Star-WebPRNT-SDK umgesetzt und gegen eine
> Drucker-Attrappe getestet (`tools/mock-printer.mjs`). Mit einem echten mC-Print3 wurde es noch nicht ausprobiert –
> bitte beim ersten Einsatz den Testdruck machen.

## Kunden importieren

Kunden › Importieren, CSV-Datei wählen (aus Excel: *Speichern unter › CSV*). Trennzeichen (`;` `,` Tab) und
Zeichensatz (UTF-8 oder Windows) werden erkannt. Danach wird zugeordnet, welche Spalte Name, Telefon, Straße,
Hausnummer, PLZ, Ort, Kundennummer und Notiz enthält; übliche Spaltennamen werden automatisch erkannt.
Vorhandene Kunden können behalten (gleiche Telefonnummer wird aktualisiert) oder komplett ersetzt werden.

## Datensicherung

Alle Daten liegen **nur auf diesem iPad** (im Browser-Speicher). Unter Einstellungen › Daten regelmäßig
„Sicherung erstellen“ und die Datei z. B. in iCloud Drive ablegen. Mit „Sicherung einlesen“ wird sie
wiederhergestellt – auch auf einem anderen Gerät. Safari und die Star-App haben getrennte Speicher: Beim Wechsel
zwischen beiden die Sicherung übertragen.

## Rechtlicher Hinweis

Diese Kasse hat **keine technische Sicherheitseinrichtung (TSE)**. Für elektronische Kassen gelten in Deutschland
die Kassensicherungsverordnung (TSE-Pflicht, Meldepflicht beim Finanzamt) und die Belegausgabepflicht. In der
jetzigen Form eignet sie sich zur Bestellannahme und zum Bondruck; für den Einsatz als alleinige Registrierkasse
muss eine zertifizierte TSE (z. B. eine Cloud-TSE) angebunden werden – bitte mit dem Steuerberater klären.
Die MwSt.-Sätze sind voreingestellt (Speisen 7 %, Getränke 19 %) und je Kategorie änderbar.

## Entwicklung

```bash
npm start          # Kasse lokal starten (http://localhost:8080)
npm test           # Logik-Tests (Preise, MwSt., CSV, Druckformat)
npm run test:e2e   # kompletter Durchlauf im Browser (benötigt Playwright)
npm run menu       # Speisekarte neu von bringstar.jetzt holen -> js/data/menu.js
node tools/mock-printer.mjs   # Drucker-Attrappe: speichert Bons als PNG in bons/
```

Ein neuer Stand der Speisekarte wird beim nächsten Start automatisch übernommen, solange in der Kasse nichts an
Artikeln oder Kategorien geändert wurde. Andernfalls unter Einstellungen › Speisekarte „zurücksetzen“ wählen
(eigene Änderungen gehen dabei verloren). Wird eine Datei unter `js/` hinzugefügt, gehört sie auch
in die Liste in `sw.js`; bei Änderungen dort `CACHE` hochzählen.

| Ordner | Inhalt |
| --- | --- |
| `js/views/` | Bildschirme: Kasse, Bestellungen, Kunden, Einstellungen |
| `js/lib/` | Zustand (`store.js`), Datenbank (`db.js`), Berechnung (`order.js`), CSV (`csv.js`) |
| `js/print/` | Bon-Aufbau (`receipt.js`), Druckbild (`raster.js`), Star WebPRNT (`webprnt.js`) |
| `js/data/` | Speisekarte (erzeugt) und Voreinstellungen |
| `vendor/` | Preact + htm, QR-Code-Erzeugung (siehe `vendor/README.md`) |
