// Durchgehender Test im echten Browser (benötigt Playwright + Chromium):
//
//   node tests/e2e.mjs [ordner-für-screenshots]
//
// Startet Webserver und Drucker-Attrappe selbst, spielt einen Abend an der Kasse durch
// und prüft, was am "Drucker" ankommt.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { startMockPrinter } from '../tools/mock-printer.mjs';

const { chromium } = createRequire(import.meta.url)('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const shots = process.argv[2] ?? (await mkdtemp(path.join(tmpdir(), 'kasse-e2e-')));
await mkdir(shots, { recursive: true });
const APP = 'http://localhost:8097/';
const PRINTER_PORT = 8098;

const server = spawn(process.execPath, [path.join(root, 'tools/serve.mjs'), '8097'], { stdio: 'ignore' });
const printer = await startMockPrinter({ port: PRINTER_PORT, outDir: path.join(shots, 'bons'), log: () => {} });
await new Promise((r) => setTimeout(r, 500));

const browser = await chromium.launch();
const problems = [];
let step = 0;
let page;
const shot = async (name) => page.screenshot({ path: path.join(shots, `${String(++step).padStart(2, '0')}-${name}.png`) });
const nav = (label) => page.locator('.rail-btn', { hasText: label }).click();
const toast = (text) => page.locator('.toast', { hasText: text }).first().waitFor({ timeout: 8000 });

try {
  const ctx = await browser.newContext({ viewport: { width: 1180, height: 820 }, hasTouch: true, locale: 'de-DE' });
  page = await ctx.newPage();
  page.on('pageerror', (e) => problems.push(`Seitenfehler: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && problems.push(`Konsole: ${m.text()}`));
  page.on('dialog', (d) => d.accept());
  await page.goto(APP);
  await page.locator('.product').first().waitFor();
  await shot('kasse-leer');

  // --- Drucker einrichten + Testdruck ---------------------------------------------------
  await nav('Einstellungen');
  await page.locator('.segmented button', { hasText: 'Drucker' }).click();
  await page.locator('select.input').selectOption('webprnt');
  await page.getByPlaceholder('192.168.178.50').fill(`localhost:${PRINTER_PORT}`);
  await page.getByPlaceholder('192.168.178.50').blur();
  await page.getByLabel('Kassenschublade bei Barzahlung öffnen').check();
  await page.getByRole('button', { name: 'Testdruck' }).click();
  await toast('Testdruck gesendet');
  assert.equal(printer.jobs.length, 1, 'Testdruck kommt am Drucker an');
  assert.match(printer.jobs[0].contentType, /^text\/xml/);
  assert.deepEqual(printer.jobs[0].elements.map((e) => e.tag), ['initialization', 'bitimage', 'cutpaper']);
  assert.equal(printer.jobs[0].elements[1].attrs.width, '576');
  await shot('drucker');

  // --- Kunden importieren (Excel-typisch: Semikolon, Windows-1252) -------------------------
  const csv = [
    'Kd-Nr;Vorname;Nachname;Telefon;Mobil;Straße;Hausnr;PLZ;Ort;Bemerkung',
    '1001;Jürgen;Müller;05509 12345;;Göttinger Straße;12a;37124;Rosdorf;Hinterhaus',
    '1002;Ayse;Yilmaz;0551/998877;0170 1234567;Am Markt;3;37124;Obernjesa;',
    '1003;;Autohaus Schröder;+49 5509 4711;;Industriestr.;8;37133;Friedland;"Tor 2; bitte klingeln"',
  ].join('\r\n');
  const csvFile = path.join(shots, 'kunden.csv');
  await writeFile(csvFile, Buffer.from(csv, 'latin1'));
  await nav('Kunden');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Importieren' }).click();
  await (await chooser).setFiles(csvFile);
  await page.getByRole('button', { name: '3 Kunden importieren' }).waitFor();
  await shot('import-zuordnung');
  await page.getByRole('button', { name: '3 Kunden importieren' }).click();
  await toast('Import fertig: 3 neu');
  await page.locator('.customer-row', { hasText: 'Jürgen Müller' }).waitFor();
  // Tabelle: Nr. | Name | Adresse | Telefon, sortiert nach Kundennummer
  assert.deepEqual(await page.locator('.customer-head span').allInnerTexts(), ['NR.', 'NAME', 'ADRESSE', 'TELEFON']);
  assert.deepEqual(await page.locator('.customer-row .cust-nr').allInnerTexts(), ['1001', '1002', '1003']);
  const juergen = page.locator('.customer-row', { hasText: 'Jürgen Müller' });
  assert.deepEqual(
    await Promise.all(['.cust-nr', '.cust-name', '.cust-addr', '.cust-phone'].map((c) => juergen.locator(c).innerText())),
    ['1001', 'Jürgen Müller\nHinterhaus', 'Göttinger Straße 12a\n37124 Rosdorf', '05509 12345'],
  );
  assert.equal(await page.locator('.customer-row', { hasText: 'Ayse Yilmaz' }).locator('.cust-phone').innerText(), '0551/998877\n0170 1234567');
  await shot('kunden');

  // --- Bestellung aufnehmen ---------------------------------------------------------------
  await nav('Kasse');

  // Nummernfeld: 221a -> Pizza Andy (Größenauswahl), 101 -> Cheesehamburger (Auswahl-Dialog), Korrektur mit ⌫ und C
  const numkey = (ch) => page.locator('.numpad .numkey', { hasText: new RegExp(`^${ch}$`) }).click();
  const display = page.locator('.numpad-display');
  for (const ch of ['2', '2', '1']) await numkey(ch);
  assert.match(await display.innerText(), /221\s+Pizza Prosciutto · ab 10,70/);
  await numkey('a');
  assert.match(await display.innerText(), /221a\s+Pizza Andy/);
  assert.equal(await page.getByPlaceholder('Artikel-Nr. oder Name').inputValue(), '221a', 'Suchfeld und Nummernfeld zeigen dasselbe');
  await page.locator('.numpad .btn.primary').click();
  await page.locator('.variant', { hasText: '30cm' }).first().click();
  await page.locator('.modal-foot .btn.primary').click();
  await page.locator('.line', { hasText: 'Pizza Andy' }).waitFor();
  assert.match(await display.innerText(), /Artikel-Nr\./, 'nach dem Hinzufügen wieder leer');
  for (const ch of ['9', '9']) await numkey(ch);
  assert.match(await display.innerText(), /Kein Artikel gefunden/);
  assert.ok(await page.locator('.numpad .btn.primary').isDisabled());
  await page.getByLabel('Letztes Zeichen löschen').click();
  await page.getByLabel('Eingabe löschen').click();
  for (const ch of ['2', '2']) await numkey(ch);
  assert.match(await display.innerText(), /11 Artikel passen/); // 220–229 und 221a
  await page.getByLabel('Eingabe löschen').click();
  for (const ch of ['1', '0', '1']) await numkey(ch);
  await page.locator('.numpad .btn.primary').click();
  await page.locator('.modal-foot .btn.primary').click(); // Burger: Dialog mit Pommes-Wahl, Vorgabe übernehmen
  await page.locator('.line', { hasText: 'Cheesehamburger' }).waitFor();
  await shot('nummernfeld');
  // wieder entfernen, damit die folgende Bestellung bei null beginnt
  await page.locator('.ticket-actions .btn').first().click();
  assert.equal(await page.locator('.ticket-lines .line').count(), 0);
  // ausblenden und wieder einblenden; die Einstellung bleibt gespeichert
  await page.getByLabel('Nummernfeld ausblenden').click();
  assert.equal(await page.locator('.numpad').count(), 0);
  await page.getByLabel('Nummernfeld einblenden').click();
  await page.locator('.numpad').waitFor();
  const search = page.getByPlaceholder('Artikel-Nr. oder Name');
  await search.fill('220');
  await search.press('Enter'); // Pizza Margherita -> Größenauswahl
  await page.locator('.variant', { hasText: '40cm' }).first().click();
  await page.locator('.extra', { hasText: 'Käserand' }).click();
  await page.locator('.extra', { hasText: 'Zwiebeln' }).click();
  await page.getByPlaceholder('z. B. gut durch').fill('gut durchgebacken');
  await shot('artikel-dialog');
  assert.match(await page.locator('.modal-foot .btn.primary').innerText(), /22,40/); // 17,40 + 2,50 + 2,50
  await page.locator('.modal-foot .btn.primary').click();

  await page.locator('.cat', { hasText: 'XXL Burger' }).click();
  // Burger: Auswahl Pommes (Vorgabe Twister) und Zutaten weglassen
  await page.locator('.product', { hasText: 'Cheesehamburger' }).click();
  const pommes = page.locator('.extras.choice .extra');
  assert.deepEqual(await pommes.allInnerTexts(), ['Twister Pommes', 'Pommes']);
  assert.equal(await pommes.first().getAttribute('aria-pressed'), 'true', 'Twister Pommes vorausgewählt');
  assert.deepEqual(await page.locator('.extras.without .extra').allInnerTexts(), ['ohne Sauce', 'ohne Salat', 'ohne Ketchup', 'ohne Tomaten', 'ohne Gurken', 'ohne Zwiebeln', 'ohne Käse']);
  await pommes.nth(1).click();
  await page.locator('.extras.without .extra', { hasText: 'ohne Zwiebeln' }).click();
  await page.locator('.extras.without .extra', { hasText: 'ohne Gurken' }).click();
  await page.locator('.stepper .btn').last().click();
  await shot('burger-dialog');
  assert.match(await page.locator('.modal-foot .btn.primary').innerText(), /25,80/); // 2 × 12,90, "ohne" kostet nichts
  await page.locator('.modal-foot .btn.primary').click();
  assert.match(await page.locator('.line', { hasText: 'Cheesehamburger' }).innerText(), /mit Pommes, ohne Gurken, ohne Zwiebeln/);
  // Bearbeiten zeigt die gewählte Auswahl wieder an
  await page.locator('.line-main', { hasText: 'Cheesehamburger' }).click();
  assert.equal(await page.locator('.extras.choice .extra', { hasText: /^Pommes$/ }).getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('.extras.without .extra', { hasText: 'ohne Zwiebeln' }).getAttribute('aria-pressed'), 'true');
  await page.locator('.modal-foot .btn.primary').click();
  await page.locator('.cat', { hasText: 'Getränke' }).click();
  await page.locator('.product', { hasText: 'Fanta' }).click();
  await page.locator('.variant', { hasText: '1,0 l' }).click();
  await page.locator('.modal-foot .btn.primary').click();

  await page.locator('.customer-btn').click();
  await page.getByPlaceholder('Telefonnummer, Name oder Straße').fill('0550912345');
  await page.locator('.modal .customer-row', { hasText: 'Jürgen Müller' }).click();
  // Rosdorf steht in keinem Liefergebiet -> Hinweis, keine Lieferkosten gesetzt
  assert.match(await page.locator('.fee-label').innerText(), /Ort nicht in den Liefergebieten/);
  assert.equal(await page.locator('.fee .chip.on').count(), 0);
  assert.deepEqual(await page.locator('.segmented').first().locator('button').allInnerTexts().then((t) => t.map((x) => x.trim())), ['Lieferung', 'Abholung']);
  assert.deepEqual(await page.locator('.fee .chip').allInnerTexts(), ['1,80', '2,50', '3,50']);
  await page.getByLabel('Lieferkosten frei eingeben').fill('4');
  await page.getByLabel('Lieferkosten frei eingeben').blur();
  assert.match(await page.locator('.total-row.grand').innerText(), /55,45/); // freier Betrag 4,00
  await page.locator('.fee .chip', { hasText: '2,50' }).click();
  await page.getByPlaceholder('Notiz zur Bestellung').fill('19:30 Uhr');
  assert.match(await page.locator('.total-row.grand').innerText(), /53,95/); // 22,40 + 2×12,90 + 3,25 + 2,50
  await shot('kasse-bestellung');

  await page.getByRole('button', { name: /Abschließen ·/ }).click();
  assert.match(await page.locator('.checkout-total').innerText(), /53,95/);
  assert.equal(await page.locator('.modal', { hasText: /Rückgeld|Gegeben/ }).count(), 0, 'keine Rückgeld-Funktion');
  await shot('abschluss');
  await page.getByRole('button', { name: 'Abschließen & drucken' }).click();
  await toast('Bestellung #1 gespeichert und gedruckt');

  const job = printer.jobs[1];
  assert.deepEqual(
    job.elements.map((e) => e.tag),
    ['initialization', 'peripheral', ...Array(4).fill(['bitimage', 'cutpaper']).flat()],
    'Schublade + Bon Pizzaseite + Bon Küchenseite + 2 Kundenbons',
  );
  const images = job.elements.filter((e) => e.tag === 'bitimage');
  assert.equal(images[2].text, images[3].text, 'die beiden Kundenbons sind identisch');
  assert.notEqual(images[0].text, images[1].text);
  assert.equal(await page.locator('.ticket-lines .line').count(), 0, 'Bon ist nach dem Abschluss leer');

  // --- Lieferkosten automatisch ----------------------------------------------------------------
  const pickCustomer = async (query, name) => {
    await page.locator('.customer-btn').click();
    await page.getByPlaceholder('Telefonnummer, Name oder Straße').fill(query);
    await page.locator('.modal .customer-row', { hasText: name }).click();
  };
  // Auswahl an der Kasse als Tabelle
  await page.locator('.customer-btn').click();
  assert.deepEqual(await page.locator('.modal .customer-row .cust-nr').allInnerTexts(), ['1001', '1002', '1003']);
  await shot('kundenauswahl');
  await page.locator('.modal-head .btn').click();
  await pickCustomer('Yilmaz', 'Ayse Yilmaz'); // Obernjesa -> 1,80
  assert.match(await page.locator('.fee-label').innerText(), /automatisch \(Obernjesa\)/);
  assert.equal(await page.locator('.fee .chip.on').innerText(), '1,80');
  await shot('lieferkosten-automatisch');
  await page.locator('.segmented button', { hasText: 'Abholung' }).click();
  assert.equal(await page.locator('.fee').count(), 0);
  await page.locator('.segmented button', { hasText: 'Lieferung' }).click();
  assert.equal(await page.locator('.fee .chip.on').innerText(), '1,80');
  await pickCustomer('Müller', 'Jürgen Müller'); // Rosdorf: wie bei der letzten Lieferung (2,50)
  assert.match(await page.locator('.fee-label').innerText(), /wie bei der letzten Lieferung/);
  assert.equal(await page.locator('.fee .chip.on').innerText(), '2,50');
  await page.locator('.fee .chip', { hasText: '3,50' }).click(); // von Hand: Hinweis verschwindet
  assert.doesNotMatch(await page.locator('.fee-label').innerText(), /automatisch|letzten/);
  await page.locator('.customer-clear').click();
  assert.match(await page.locator('.total-row.grand').innerText(), /3,50/, 'von Hand gewählte Lieferkosten bleiben');
  await page.locator('.ticket-actions .btn').first().click(); // verwerfen
  assert.match(await page.locator('.total-row.grand').innerText(), /0,00/);
  await pickCustomer('Yilmaz', 'Ayse Yilmaz');
  await page.locator('.customer-clear').click();
  assert.match(await page.locator('.total-row.grand').innerText(), /0,00/, 'automatische Lieferkosten gehen mit dem Kunden');

  // --- Bestellübersicht, Nachdruck, Storno ------------------------------------------------------
  await nav('Bestellungen');
  await page.locator('.order-row').first().waitFor();
  assert.match(await page.locator('.summary .stat').innerText(), /53,95/);
  await shot('bestellungen');
  await page.locator('.order-row').first().click();
  await page.locator('.receipt-preview canvas').waitFor();
  await shot('bestellung-detail');
  await page.getByRole('button', { name: 'Kundenbon' }).click();
  await toast('Kundenbon gedruckt');
  assert.equal(printer.jobs.at(-1).elements.filter((e) => e.tag === 'bitimage').length, 1, 'Nachdruck: ein Kundenbon');
  await page.getByRole('button', { name: 'Küchenbons' }).click();
  await toast('Küchenbons gedruckt');
  assert.equal(printer.jobs.at(-1).elements.filter((e) => e.tag === 'bitimage').length, 2, 'Nachdruck: Pizzaseite + Küchenseite');
  await page.getByRole('button', { name: 'Stornieren' }).click();
  await toast('storniert');
  await page.locator('.modal-head .btn').click();
  assert.match(await page.locator('.summary .stat').innerText(), /0,00/);
  assert.match(await page.locator('.order-row').first().innerText(), /storniert/);

  // --- Daten überleben einen Neustart ------------------------------------------------------------
  await page.reload();
  await page.locator('.product').first().waitFor();
  await nav('Kunden');
  await page.locator('.customer-row').first().waitFor();
  assert.equal(await page.locator('.customer-row').count(), 3);
  await nav('Bestellungen');
  await page.locator('.order-row').first().waitFor();
  assert.equal(await page.locator('.order-row').count(), 1);

  // --- Hochformat -------------------------------------------------------------------------------
  await page.setViewportSize({ width: 820, height: 1180 });
  await nav('Kasse');
  await page.locator('.product').first().click();
  await page.locator('.variant').first().waitFor();
  await shot('hochformat-dialog');
  await page.locator('.modal-foot .btn.primary').click();
  await shot('hochformat');

  await ctx.close();

  // ============ Zweiter Durchlauf: ohne Drucker, Fehlerfälle, Verwaltung =======================
  const ctx2 = await browser.newContext({ viewport: { width: 1366, height: 1024 }, locale: 'de-DE', acceptDownloads: true });
  page = await ctx2.newPage();
  page.on('pageerror', (e) => problems.push(`Seitenfehler: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource|ERR_CONNECTION_REFUSED|PrintError/.test(m.text()) && problems.push(`Konsole: ${m.text()}`));
  page.on('dialog', (d) => d.accept());
  await page.addInitScript(() => {
    window.__printCalls = 0;
    window.print = () => window.__printCalls++;
  });
  // Uhrzeit festhalten, damit Fälligkeiten prüfbar sind (Timer laufen normal weiter)
  await page.clock.setFixedTime(new Date(2026, 10, 24, 18, 0));
  await page.goto(APP);
  await page.locator('.product').first().waitFor();

  // Neuer Kunde direkt an der Kasse
  await page.locator('.customer-btn').click();
  await page.getByPlaceholder('Telefonnummer, Name oder Straße').fill('0551 445566');
  await page.getByRole('button', { name: /Neuer Kunde/ }).click();
  const field = (label) => page.locator('.modal .field', { hasText: label }).locator('input');
  assert.equal(await field('Telefon').first().inputValue(), '0551 445566');
  await field('Name').fill('Sabine Krüger');
  await field('Straße und Hausnummer').fill('Lindenweg 4');
  await field('PLZ').fill('37124');
  await field('Ort').fill('Rosdorf');
  await page.getByRole('button', { name: 'Speichern' }).click();
  await page.locator('.customer-btn.has', { hasText: 'Sabine Krüger' }).waitFor();

  // Gyros: Twister Pommes kosten 1,50 € mehr
  await page.locator('.cat', { hasText: 'Gyros vom Spieß' }).click();
  await page.locator('.product', { hasText: 'Gyros (2) mit Zaziki' }).click();
  assert.match(await page.locator('.modal-foot .btn.primary').innerText(), /14,90/);
  await page.locator('.extras.choice .extra', { hasText: 'Twister Pommes' }).click();
  assert.match(await page.locator('.extras.choice .extra', { hasText: 'Twister Pommes' }).innerText(), /\+1,50/);
  assert.match(await page.locator('.modal-foot .btn.primary').innerText(), /16,40/);
  await page.locator('.modal-foot .btn.primary').click();
  assert.match(await page.locator('.line', { hasText: 'Gyros' }).innerText(), /mit Twister Pommes[\s\S]*16,40/);
  // Nuggets: ohne Sauce kein Hinzufügen
  await page.locator('.cat', { hasText: 'Chicken Nuggets' }).click();
  await page.locator('.product', { hasText: 'Nuggets mit Twister Pommes' }).click();
  await page.locator('.variant', { hasText: '20er' }).click();
  assert.ok(await page.locator('.modal-foot .btn.primary').isDisabled());
  assert.match(await page.locator('.modal-foot .btn.primary').innerText(), /Bitte Sauce wählen/);
  await page.locator('.extras.choice .extra', { hasText: 'BBQ-Sauce' }).click();
  await shot('nuggets-dialog');
  await page.locator('.modal-foot .btn.primary').click();
  assert.match(await page.locator('.line', { hasText: 'Nuggets' }).innerText(), /20er[\s\S]*mit BBQ-Sauce[\s\S]*15,90/);
  // Salat: Größe und Dressing (Pflicht)
  await page.locator('.cat', { hasText: 'Salat' }).click();
  await page.locator('.product', { hasText: 'Bauernsalat' }).click();
  await page.locator('.variant', { hasText: 'groß' }).click();
  assert.match(await page.locator('.modal-foot .btn.primary').innerText(), /Bitte Dressing wählen/);
  await page.locator('.extras.choice .extra', { hasText: 'Essig+Öl' }).click();
  await page.locator('.modal-foot .btn.primary').click();
  assert.match(await page.locator('.line', { hasText: 'Bauernsalat' }).innerText(), /groß[\s\S]*Dressing: Essig\+Öl[\s\S]*9,60/);
  // Neuer Artikel "Joghurt groß" unter Beilagen, ohne Dialog direkt auf den Bon
  await page.locator('.cat', { hasText: 'Beilagen' }).click();
  assert.deepEqual((await page.locator('.product .product-name').allInnerTexts()).slice(-2), ['Joghurt klein', 'Joghurt groß']);
  await page.locator('.product', { hasText: 'Joghurt groß' }).click();
  assert.match(await page.locator('.line', { hasText: 'Joghurt groß' }).innerText(), /2,50/);
  await page.locator('.product', { hasText: 'Joghurt klein' }).click();
  assert.match(await page.locator('.line', { hasText: 'Joghurt klein' }).innerText(), /1,50/);
  // wieder entfernen
  for (const name of ['Gyros', 'Nuggets', 'Bauernsalat', 'Joghurt groß', 'Joghurt klein']) await page.locator('.line', { hasText: name }).locator('.qty-btn').first().click();
  assert.equal(await page.locator('.line').count(), 0);

  // Position bearbeiten (Extras für Burger), freier Artikel
  await page.locator('.cat', { hasText: 'XXL Burger' }).click();
  await page.locator('.product', { hasText: 'Baconburger' }).click();
  await page.locator('.modal-foot .btn.primary').click();
  await page.locator('.line-main', { hasText: 'Baconburger' }).click();
  await page.locator('.extra', { hasText: 'Schmelzkäse' }).click();
  await page.locator('.stepper .btn').last().click();
  assert.match(await page.locator('.modal-foot .btn.primary').innerText(), /29,40/); // 2 × (13,20 + 1,50)
  await page.locator('.modal-foot .btn.primary').click();
  await page.getByRole('button', { name: 'Freier Artikel' }).click();
  await page.locator('.modal .field', { hasText: 'Bezeichnung' }).locator('input').fill('Tiramisu');
  await page.locator('.modal .money-input').fill('4,5');
  await page.locator('.modal-foot .btn.primary').click();
  await page.locator('.line', { hasText: 'Tiramisu' }).waitFor();
  assert.match(await page.locator('.total-row.grand').innerText(), /33,90/);
  // Menge über die Bon-Zeile: + und wieder −, dann Position löschen
  const tira = page.locator('.line', { hasText: 'Tiramisu' });
  await tira.locator('.qty-btn').last().click();
  assert.match(await page.locator('.total-row.grand').innerText(), /38,40/);
  await tira.locator('.qty-btn').first().click();
  await tira.locator('.qty-btn').first().click();
  assert.equal(await page.locator('.line').count(), 1);
  await shot('kasse-gross');

  // Abschluss ohne Drucker, als Vorbestellung zur Abholung um 19:30
  await page.locator('.segmented button', { hasText: 'Abholung' }).click();
  await page.getByLabel('Vorbestellung: Uhrzeit').fill('19:30');
  await page.getByRole('button', { name: /Abschließen ·/ }).click();
  assert.match(await page.locator('.due-info').innerText(), /Abholung um 19:30 Uhr/);
  await page.locator('.segmented button', { hasText: 'Karte' }).click();
  await page.getByRole('button', { name: 'Abschließen', exact: true }).click();
  await toast('kein Drucker eingerichtet');
  assert.equal(await page.locator('.chip', { hasText: 'Sofort' }).getAttribute('class').then((c) => c.includes('on')), true, 'neue Bestellung wieder "Sofort"');
  assert.equal(await page.locator('.rail-badge').innerText(), '1');
  await nav('Offen');
  const card1 = page.locator('.open-card', { hasText: '#1' });
  assert.match(await card1.innerText(), /Vorbestellt 19:30 · noch 1 Std\. 30 Min\./);
  assert.match(await card1.getAttribute('class'), /lvl-pre/);
  await nav('Kasse');

  // Küchenbons als Vorschau: nur Burger bestellt -> nur ein Bon (Küchenseite)
  await nav('Bestellungen');
  await page.locator('.order-row').first().click();
  await page.getByRole('button', { name: 'Küchenbons' }).click();
  await page.locator('.modal-sm .receipt-preview canvas').first().waitFor();
  assert.equal(await page.locator('.modal-sm .receipt-preview canvas').count(), 1);
  await page.locator('.modal-sm .modal-head .btn').click();
  await page.locator('.modal-head .btn').click();

  // Tagesbericht als Vorschau
  await nav('Bestellungen');
  await page.locator('.order-row').first().waitFor();
  await page.getByRole('button', { name: 'Tagesbericht' }).click();
  await page.locator('.receipt-preview canvas').waitFor();
  await shot('tagesbericht-vorschau');
  await page.locator('.modal-head .btn').click();

  // Erneut bestellen -> zurück an der Kasse mit Kunde und Artikeln
  await page.locator('.order-row').first().click();
  await page.getByRole('button', { name: 'Erneut bestellen' }).click();
  await page.locator('.customer-btn.has', { hasText: 'Sabine Krüger' }).waitFor();
  assert.equal(await page.locator('.line').count(), 1);

  // Drucker nicht erreichbar: Bestellung bleibt gespeichert, verständliche Meldung
  await nav('Einstellungen');
  await page.locator('.segmented button', { hasText: 'Drucker' }).click();
  await page.locator('select.input').selectOption('webprnt');
  await page.getByPlaceholder('192.168.178.50').fill('localhost:9');
  await page.getByPlaceholder('192.168.178.50').blur();
  await nav('Kasse');
  await page.locator('.segmented button', { hasText: 'Lieferung' }).click();
  await page.getByRole('button', { name: /Abschließen ·/ }).click();
  await page.getByRole('button', { name: 'Abschließen & drucken' }).click();
  await toast('ist gespeichert, aber: Drucker nicht erreichbar');

  // --- Offene Bestellungen: 50 Minuten später -------------------------------------------------
  await page.clock.setFixedTime(new Date(2026, 10, 24, 18, 50));
  await nav('Offen');
  const cards = page.locator('.open-list').first().locator('.open-card');
  assert.equal(await cards.count(), 2);
  assert.match(await cards.first().innerText(), /#2[\s\S]*Lieferung[\s\S]*Sabine Krüger[\s\S]*fällig 18:45 · 5 Min\. überfällig[\s\S]*seit 50 Min\./, 'dringendste zuerst');
  assert.match(await cards.first().getAttribute('class'), /lvl-late/);
  assert.match(await cards.nth(1).innerText(), /#1[\s\S]*Vorbestellt 19:30 · noch 40 Min\./);
  assert.match(await page.locator('.late-badge').innerText(), /1 überfällig/);
  assert.match(await page.locator('.rail-badge').getAttribute('class'), /late/);
  assert.equal(await page.locator('.rail-badge').innerText(), '2');
  await shot('offen');
  await cards.first().getByRole('button', { name: /Unterwegs/ }).click();
  const moving = page.locator('.open-list').nth(1).locator('.open-card');
  await moving.first().waitFor();
  assert.match(await moving.first().innerText(), /#2[\s\S]*Unterwegs seit 0 Min\./);
  assert.equal(await page.locator('.rail-badge').innerText(), '1');
  assert.doesNotMatch(await page.locator('.rail-badge').getAttribute('class'), /late/);
  await moving.first().getByRole('button', { name: /Geliefert/ }).click();
  await page.locator('.open-list').nth(1).locator('.open-card').waitFor({ state: 'detached' });
  // Abholung: Abholbereit -> Abgeholt; "Zurück" setzt in die Küche zurück
  await cards.first().getByRole('button', { name: /Abholbereit/ }).click();
  await moving.first().getByRole('button', { name: 'Zurück in die Küche' }).click();
  await cards.first().getByRole('button', { name: /Abholbereit/ }).waitFor();
  // Antippen öffnet die Bestellung (Nachdruck, Storno)
  await cards.first().click();
  await page.locator('.modal .receipt-preview canvas').waitFor();
  await page.locator('.modal-head .btn').click();
  await nav('Bestellungen');
  assert.match(await page.locator('.order-row', { hasText: '#1' }).innerText(), /In der Küche/);
  assert.doesNotMatch(await page.locator('.order-row', { hasText: '#2' }).innerText(), /In der Küche|Unterwegs/);
  await nav('Bestellungen');
  await page.locator('.order-row').nth(1).waitFor();

  // AirPrint: Druckdialog wird mit dem Bon als Bild aufgerufen
  await nav('Einstellungen');
  await page.locator('.segmented button', { hasText: 'Drucker' }).click();
  await page.locator('select.input').selectOption('system');
  await page.getByRole('button', { name: 'Testdruck' }).click();
  await toast('Testdruck gesendet');
  assert.equal(await page.evaluate(() => window.__printCalls), 1);
  assert.equal(await page.locator('#print-root img').count(), 1);

  // Star webPRNT Browser: Auftrag geht über die Schnittstelle der App, Antwort über _onFinish
  await page.evaluate(() => {
    window.__appJobs = [];
    window.webkit = {
      messageHandlers: {
        sendMessageHandler: {
          postMessage(json) {
            const job = JSON.parse(json);
            window.__appJobs.push(job);
            setTimeout(() => window._onFinish({ url: job.url, htmlCode: 200, response: '&lt;root&gt;&lt;success&gt;true&lt;/success&gt;&lt;code&gt;0&lt;/code&gt;&lt;status&gt;23860000000400000000&lt;/status&gt;&lt;/root&gt;' }), 50);
          },
        },
      },
    };
    Object.defineProperty(navigator, 'userAgent', { get: () => 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) webPRNTSupportMessageHandler WebPRNTSupportHTTPS' });
  });
  await page.locator('select.input').selectOption('browser');
  await page.getByRole('button', { name: 'Testdruck' }).click();
  await toast('Testdruck gesendet');
  await toast('Papierrolle ist fast leer');
  const appJob = await page.evaluate(() => window.__appJobs[0]);
  assert.equal(appJob.url, 'http://localhost:8001/StarWebPRNT/SendMessage');
  assert.match(appJob.body, /^<StarWebPrint xmlns="http:\/\/www\.star-m\.jp"[^>]*><Request>&lt;root&gt;&lt;initialization\/&gt;&lt;bitimage width="576" height="\d+"&gt;[A-Za-z0-9+/=]+&lt;\/bitimage&gt;&lt;cutpaper feed="true"\/&gt;&lt;\/root&gt;<\/Request><\/StarWebPrint>$/);
  await page.locator('select.input').selectOption('none');

  // Speisekarte: Preis ändern, neuen Artikel anlegen, an der Kasse sichtbar
  await page.locator('.segmented button', { hasText: 'Speisekarte' }).click();
  await page.locator('tr', { hasText: 'Pizza Margherita' }).click();
  await page.locator('.variant-row .money-input').first().fill('9,90');
  await page.getByRole('button', { name: 'Speichern' }).click();
  await page.locator('tr', { hasText: '30cm: 9,90' }).waitFor();
  await page.getByRole('button', { name: 'Artikel', exact: true }).click();
  await page.locator('.modal .field', { hasText: 'Artikelnummer' }).locator('input').fill('299');
  await page.locator('.modal .field', { hasText: 'Name' }).locator('input').fill('Pizza Spezial');
  await page.locator('.variant-row .money-input').fill('13');
  await page.getByRole('button', { name: 'Speichern' }).click();
  await page.locator('tr', { hasText: 'Pizza Spezial' }).waitFor();
  await shot('speisekarte');
  await nav('Kasse');
  await page.getByPlaceholder('Artikel-Nr. oder Name').fill('299');
  await page.getByPlaceholder('Artikel-Nr. oder Name').press('Enter');
  await page.locator('.line', { hasText: 'Pizza Spezial' }).waitFor();
  await page.getByPlaceholder('Artikel-Nr. oder Name').fill('margh');
  assert.match(await page.locator('.product').first().innerText(), /ab 9,90/);

  // Datensicherung: erstellen, Daten verändern, wieder einlesen
  await nav('Einstellungen');
  await page.locator('.segmented button', { hasText: 'Daten' }).click();
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Sicherung erstellen' }).click();
  const backupFile = path.join(shots, 'sicherung.json');
  await (await dl).saveAs(backupFile);
  await nav('Kunden');
  await page.locator('.customer-row', { hasText: 'Sabine Krüger' }).click();
  await page.getByRole('button', { name: 'Löschen' }).click();
  await page.locator('.empty.big').waitFor();
  await nav('Einstellungen');
  await page.locator('.segmented button', { hasText: 'Daten' }).click();
  const chooser2 = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Sicherung einlesen' }).click();
  await (await chooser2).setFiles(backupFile);
  await toast('Sicherung eingelesen');
  await nav('Kunden');
  await page.locator('.customer-row', { hasText: 'Sabine Krüger' }).waitFor();
  const csvDl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exportieren' }).click();
  assert.match((await csvDl).suggestedFilename(), /^kunden-\d{4}-\d\d-\d\d\.csv$/);
  await nav('Bestellungen');
  await page.locator('.order-row').nth(1).waitFor();
  assert.equal(await page.locator('.order-row').count(), 2);

  assert.deepEqual(problems, [], 'keine Fehler in der Browser-Konsole');
  console.log(`OK – ${printer.jobs.length} Druckaufträge, Screenshots und Bons in ${shots}`);
} catch (e) {
  if (page) await shot('FEHLER').catch(() => {});
  console.error(e);
  if (problems.length) console.error(problems);
  process.exitCode = 1;
} finally {
  await browser.close();
  printer.server.close();
  server.kill();
}
