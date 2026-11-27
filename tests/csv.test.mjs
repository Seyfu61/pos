import test from 'node:test';
import assert from 'node:assert/strict';

import { customersToRows, decodeText, detectDelimiter, guessMapping, indexCustomer, looksLikeHeader, parseCsv, rowsToCustomers, searchCustomers, toCsv } from '../js/lib/csv.js';

test('CSV lesen: Trennzeichen, Anführungszeichen, Zeilenumbrüche', () => {
  assert.equal(detectDelimiter('a;b;c\n1;2;3'), ';');
  assert.equal(detectDelimiter('a,b,c\n1,2,3'), ',');
  assert.equal(detectDelimiter('a\tb\n1\t2'), '\t');
  assert.deepEqual(parseCsv('\ufeffName;Ort\r\n"Müller; Hans";"Ros""dorf"\r\n\r\n"mehr\nzeilig";x\r\n'), [
    ['Name', 'Ort'],
    ['Müller; Hans', 'Ros"dorf'],
    ['mehr\nzeilig', 'x'],
  ]);
  assert.deepEqual(parseCsv('a,b\n1,2'), [['a', 'b'], ['1', '2']]);
});

test('Zeichensatz: UTF-8 und Windows-1252 (Excel)', () => {
  assert.equal(decodeText(new TextEncoder().encode('Müller Straße').buffer), 'Müller Straße');
  assert.equal(decodeText(Uint8Array.from([0x4d, 0xfc, 0x6c, 0x6c, 0x65, 0x72, 0x20, 0x80]).buffer), 'Müller €');
});

test('Spalten automatisch zuordnen', () => {
  const header = ['Kd-Nr', 'Vorname', 'Nachname', 'Telefon', 'Mobil', 'Straße', 'Hausnr', 'PLZ', 'Ort', 'Bemerkung'];
  assert.ok(looksLikeHeader(header));
  assert.ok(!looksLikeHeader(['1001', 'Jürgen', '05509 12345']));
  assert.deepEqual(guessMapping(header), { nr: 0, firstName: 1, lastName: 2, phone: 3, phone2: 4, street: 5, houseNo: 6, zip: 7, city: 8, note: 9 });
  assert.deepEqual(guessMapping(['NAME', 'Tel.', 'Adresse', 'Postleitzahl', 'Stadt']), { name: 0, phone: 1, street: 2, zip: 3, city: 4 });
});

test('Zeilen in Kunden umwandeln', () => {
  const mapping = { nr: 0, firstName: 1, lastName: 2, phone: 3, phone2: 4, street: 5, houseNo: 6, zip: 7, city: 8, note: 9 };
  const rows = [
    ['1001', 'Jürgen', 'Müller', '05509 12345', '', 'Göttinger Straße', '12a', '37124', 'Rosdorf', 'Hinterhaus'],
    ['1002', '', '', '', '0170 1234567', '', '', '', '', ''],
    ['', '', '', '', '', '', '', '', '', ''],
  ];
  assert.deepEqual(rowsToCustomers(rows, mapping), [
    { nr: '1001', name: 'Jürgen Müller', phone: '05509 12345', phone2: '', street: 'Göttinger Straße 12a', zip: '37124', city: 'Rosdorf', note: 'Hinterhaus' },
    { nr: '1002', name: '', phone: '0170 1234567', phone2: '', street: '', zip: '', city: '', note: '' },
  ]);
  // "Name" + "Vorname" ohne Nachname-Spalte: Name ist der Nachname
  assert.equal(rowsToCustomers([['Müller', 'Jürgen']], { name: 0, firstName: 1 })[0].name, 'Jürgen Müller');
  // Firma ohne Namen wird zum Namen, mit Namen zur Notiz
  assert.equal(rowsToCustomers([['', 'Autohaus Schröder']], { name: 0, company: 1 })[0].name, 'Autohaus Schröder');
  assert.equal(rowsToCustomers([['Schröder', 'Autohaus']], { name: 0, company: 1 })[0].note, 'Autohaus');
});

test('Export lässt sich wieder einlesen', () => {
  const customers = [{ nr: '7', name: 'Müller; "Hans"', phone: '0551 1', phone2: '', street: 'Weg 1', zip: '37124', city: 'Rosdorf', note: 'Zeile1\nZeile2' }];
  const rows = parseCsv(toCsv(customersToRows(customers)));
  assert.deepEqual(rowsToCustomers(rows.slice(1), guessMapping(rows[0])), customers);
});

test('Kundensuche über Telefonnummer, Name und Straße', () => {
  const list = [
    { id: 1, nr: '1001', name: 'Jürgen Müller', phone: '05509 12345', phone2: '', street: 'Göttinger Straße 12a', zip: '37124', city: 'Rosdorf' },
    { id: 2, nr: '1002', name: 'Ayse Yilmaz', phone: '0551/998877', phone2: '+49 170 1234567', street: 'Am Markt 3', zip: '37124', city: 'Obernjesa' },
    { id: 3, nr: '1003', name: 'Autohaus Schröder', phone: '+49 5509 4711', phone2: '', street: 'Industriestr. 8', zip: '37133', city: 'Friedland' },
  ].map(indexCustomer);
  const ids = (q) => searchCustomers(list, q).map((c) => c.id);
  assert.deepEqual(ids('0550912345'), [1]);
  assert.deepEqual(ids('05509 4711'), [3], 'gespeichert als +49 …');
  assert.deepEqual(ids('1234567'), [2], 'Teil der Mobilnummer');
  assert.deepEqual(ids('05509'), [1, 3], 'gleiche Vorwahl: Reihenfolge der Liste (Kundennummer)');
  assert.deepEqual(ids('muller'), [1], 'ohne Umlaut getippt');
  assert.deepEqual(ids('göttinger str'), [1]);
  assert.deepEqual(ids('schroder friedland'), [3]);
  assert.deepEqual(ids('1002'), [2], 'Kundennummer');
  assert.deepEqual(ids('xyz'), []);
  assert.equal(searchCustomers(list, '').length, 3);
});

test('Kundensuche gezielt in einer Spalte', () => {
  const list = [
    { id: 1, nr: '1001', name: 'Jürgen Müller', phone: '05509 12345', phone2: '', street: 'Göttinger Straße 12a', zip: '37124', city: 'Rosdorf' },
    { id: 2, nr: '1002', name: 'Ayse Yilmaz', phone: '0551/998877', phone2: '+49 170 1234567', street: 'Am Markt 3', zip: '37124', city: 'Obernjesa' },
    { id: 3, nr: '1003', name: 'Autohaus Schröder', phone: '+49 5509 4711', phone2: '', street: 'Müllerweg 8', zip: '37133', city: 'Friedland' },
    { id: 4, nr: '10', name: 'Hans 1002', phone: '0170 1002', phone2: '', street: 'Am Markt 1002', zip: '37124', city: 'Rosdorf' },
  ].map(indexCustomer);
  const ids = (q, field) => searchCustomers(list, q, 50, field).map((c) => c.id);
  // Kundennummer: exakt vor "beginnt mit", nichts aus Name/Telefon/Adresse
  assert.deepEqual(ids('1002', 'nr'), [2]);
  assert.deepEqual(ids('10', 'nr'), [4, 1, 2, 3]);
  assert.deepEqual(ids('100', 'nr'), [1, 2, 3]);
  assert.deepEqual(ids('1002', 'all').sort(), [2, 4], 'Alle: Nummer und Telefon');
  // Name: "Müller" nur im Namen, nicht in der Straße "Müllerweg"
  assert.deepEqual(ids('müller', 'name'), [1]);
  assert.deepEqual(ids('muller', 'all'), [1, 3]);
  assert.deepEqual(ids('1002', 'name'), [4]);
  // Adresse: Straße, PLZ, Ort
  assert.deepEqual(ids('am markt', 'address'), [2, 4]);
  assert.deepEqual(ids('obernjesa', 'address'), [2]);
  assert.deepEqual(ids('37133', 'address'), [3]);
  assert.deepEqual(ids('yilmaz', 'address'), []);
  // Telefon: nur Ziffern in den Telefonnummern
  assert.deepEqual(ids('1234567', 'phone'), [2]);
  assert.deepEqual(ids('05509', 'phone'), [1, 3]);
  assert.deepEqual(ids('1003', 'phone'), [], 'Kundennummer zählt nicht');
  assert.deepEqual(ids('Müller', 'phone'), []);
  // Leere Suche: alle, unabhängig vom Feld
  assert.equal(searchCustomers(list, '', 50, 'name').length, 4);
});
