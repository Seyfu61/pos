import test from 'node:test';
import assert from 'node:assert/strict';

import { buildRequest, bytesToBase64, drawerRequest, endpointUrl, envelope, packMono, parseResponse, paperNearEnd, statusMessages } from '../js/print/webprnt.js';
import { customerReceipt, dayReport, kitchenTicket, testPage } from '../js/print/receipt.js';
import { monoToPng, parseJob } from '../tools/mock-printer.mjs';
import { mergeSettings } from '../js/data/defaults.js';
import { daySummary } from '../js/lib/order.js';

const px = (black) => (black ? [0, 0, 0, 255] : [255, 255, 255, 255]);

test('Rasterbild: 1 Bit je Punkt, höchstwertiges Bit zuerst, Zeilen auf Bytes aufgefüllt', () => {
  // 10 Punkte breit, 2 Zeilen:  #.......#.   /   .#########
  const row1 = [1, 0, 0, 0, 0, 0, 0, 0, 1, 0];
  const row2 = [0, 1, 1, 1, 1, 1, 1, 1, 1, 1];
  const rgba = Uint8ClampedArray.from([...row1, ...row2].flatMap(px));
  const bits = packMono(rgba, 10, 2);
  assert.deepEqual([...bits], [0b10000000, 0b10000000, 0b01111111, 0b11000000]);
  assert.equal(bytesToBase64(bits), 'gIB/wA==');
});

test('Rasterbild: Graustufen und Transparenz', () => {
  const rgba = Uint8ClampedArray.from([
    ...[100, 100, 100, 255], // dunkelgrau -> schwarz
    ...[200, 200, 200, 255], // hellgrau -> weiß
    ...[0, 0, 0, 0], // transparent -> weiß
    ...[0, 0, 0, 200], // fast deckendes Schwarz -> schwarz
    ...[255, 0, 0, 255], // Rot (Helligkeit 30 %) -> schwarz
    ...[255, 255, 0, 255], // Gelb -> weiß
  ]);
  assert.deepEqual([...packMono(rgba, 6, 1)], [0b10011000]);
});

test('WebPRNT-Auftrag entspricht dem Format des Star-SDK', () => {
  const img = { width: 8, height: 1, base64: 'gA==' };
  assert.equal(buildRequest([img]), '<initialization/><bitimage width="8" height="1">gA==</bitimage><cutpaper feed="true"/>');
  assert.equal(
    buildRequest([img, img], { drawer: true }),
    '<initialization/><peripheral channel="1" on="200" off="200"/><bitimage width="8" height="1">gA==</bitimage><cutpaper feed="true"/><bitimage width="8" height="1">gA==</bitimage><cutpaper feed="true"/>',
  );
  assert.equal(drawerRequest(), '<peripheral channel="1" on="200" off="200"/>');
  assert.equal(
    envelope('<initialization/><cutpaper feed="true"/>'),
    '<StarWebPrint xmlns="http://www.star-m.jp" xmlns:i="http://www.w3.org/2001/XMLSchema-instance"><Request>&lt;root&gt;&lt;initialization/&gt;&lt;cutpaper feed="true"/&gt;&lt;/root&gt;</Request></StarWebPrint>',
  );
});

test('Auftrag lässt sich auf der Druckerseite wieder lesen (Attrappe)', () => {
  const bits = Uint8Array.from([0b10000000, 0b10000000, 0b01111111, 0b11000000]);
  const els = parseJob(envelope(buildRequest([{ width: 10, height: 2, base64: bytesToBase64(bits) }], { drawer: true })));
  assert.deepEqual(els.map((e) => e.tag), ['initialization', 'peripheral', 'bitimage', 'cutpaper']);
  assert.deepEqual(els[2].attrs, { width: '10', height: '2' });
  assert.deepEqual([...Buffer.from(els[2].text, 'base64')], [...bits]);
  assert.equal(monoToPng(10, 2, Buffer.from(bits)).subarray(1, 4).toString(), 'PNG');
  assert.throws(() => monoToPng(10, 3, Buffer.from(bits)));
});

test('Druckeradresse', () => {
  assert.equal(endpointUrl({ driver: 'webprnt', host: '192.168.178.50' }), 'http://192.168.178.50/StarWebPRNT/SendMessage');
  assert.equal(endpointUrl({ driver: 'webprnt', host: ' 192.168.178.50/ ', https: true }), 'https://192.168.178.50/StarWebPRNT/SendMessage');
  assert.equal(endpointUrl({ driver: 'webprnt', host: 'http://192.168.178.50' }), 'http://192.168.178.50/StarWebPRNT/SendMessage');
  assert.equal(endpointUrl({ driver: 'webprnt', host: 'https://drucker.local/StarWebPRNT/SendMessage' }), 'https://drucker.local/StarWebPRNT/SendMessage');
  assert.equal(endpointUrl({ driver: 'webprnt', host: '' }), '');
  assert.equal(endpointUrl({ driver: 'browser', host: 'egal' }), 'http://localhost:8001/StarWebPRNT/SendMessage');
});

test('Antwort und Status des Druckers auswerten', () => {
  const xml = (inner) => `<StarWebPrint xmlns="http://www.star-m.jp"><Response>${inner.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</Response></StarWebPrint>`;
  assert.deepEqual(parseResponse(xml('<root><success>true</success><code>0</code><status>23860000000000000000</status></root>')), { success: true, code: '0', status: '23860000000000000000' });
  assert.equal(parseResponse(xml('<root><success>false</success><code>1100</code><status></status></root>')).success, false);
  // Antwort der iOS-App kommt bereits mit escapten Tags
  assert.equal(parseResponse('&lt;success&gt;true&lt;/success&gt;&lt;code&gt;0&lt;/code&gt;&lt;status&gt;2386&lt;/status&gt;').success, true);
  assert.equal(parseResponse('').success, false);

  assert.deepEqual(statusMessages('23860000000000000000'), []);
  assert.deepEqual(statusMessages('23862800000000000000'), ['Deckel ist offen']);
  assert.deepEqual(statusMessages('23860800000800000000'), ['Papier ist leer']);
  assert.deepEqual(statusMessages('23860800000000000000'), ['Drucker ist offline']);
  assert.deepEqual(statusMessages(''), []);
  assert.equal(paperNearEnd('23860000000400000000'), true);
  assert.equal(paperNearEnd('23860000000000000000'), false);
});

const order = {
  id: 1,
  bonNr: 42,
  dayNr: 7,
  createdAt: '2026-11-16T18:32:00',
  day: '2026-11-16',
  status: 'done',
  type: 'delivery',
  customer: { name: 'Jürgen Müller', street: 'Göttinger Straße 12a', zip: '37124', city: 'Rosdorf', phone: '05509 12345', note: 'Hinterhaus' },
  lines: [
    { nr: '220', name: 'Pizza Margherita', variant: '40cm', unitPrice: 1740, qty: 2, tax: 7, extras: [{ name: 'Käserand', price: 250 }], note: 'ohne Zwiebeln' },
    { nr: '', name: 'Fanta', variant: '1,0 l', unitPrice: 325, qty: 1, tax: 19, extras: [], note: '' },
  ],
  note: '19:30 Uhr',
  itemsTotal: 4305,
  deliveryFee: 200,
  total: 4505,
  taxes: [
    { rate: 7, gross: 4180, net: 3907, tax: 273 },
    { rate: 19, gross: 325, net: 273, tax: 52 },
  ],
  payment: 'cash',
  given: 5000,
};
const texts = (blocks) => blocks.flatMap((b) => [b.text, b.left, b.right, ...(b.cells ?? []).map((c) => c.text)]).filter((t) => t != null);

test('Kundenbon enthält alle Angaben', () => {
  const t = texts(customerReceipt(order, mergeSettings({ shop: { taxId: 'St.-Nr. 20/123/45678' } })));
  for (const expected of [
    'Pizza Haus & mehr', 'Steintorstraße 1b', 'Tel. 05509 999440', 'St.-Nr. 20/123/45678', 'Bon-Nr. 42', '16.11.2026 18:32', 'LIEFERUNG  #7',
    'Jürgen Müller', 'Göttinger Straße 12a', '37124 Rosdorf', 'Hinweis: Hinterhaus', '» 19:30 Uhr',
    '2x 220 Pizza Margherita 40cm', '34,80', '+ Käserand', '5,00', '» ohne Zwiebeln', '1x Fanta 1,0 l', '3,25',
    'Zwischensumme', '43,05', 'Lieferkosten', '2,00', 'SUMME', '45,05 €', 'Bar', 'Gegeben', '50,00', 'Rückgeld', '4,95',
    '7 %', '39,07', '2,73', '41,80', '19 %', '0,52', 'Guten Appetit!',
  ]) {
    assert.ok(t.includes(expected), `fehlt: ${expected}`);
  }
  assert.ok(!t.includes('STORNIERT'));
  assert.ok(texts(customerReceipt({ ...order, status: 'cancelled' }, mergeSettings())).includes('STORNIERT'));
  // Abholung: keine Adresse, kein Rückgeld bei Kartenzahlung
  const pickup = texts(customerReceipt({ ...order, type: 'pickup', deliveryFee: 0, total: 4305, payment: 'card', given: null }, mergeSettings()));
  assert.ok(pickup.includes('ABHOLUNG  #7') && pickup.includes('Karte') && pickup.includes('Jürgen Müller'));
  assert.ok(!pickup.includes('Göttinger Straße 12a') && !pickup.includes('Rückgeld') && !pickup.includes('Lieferkosten'));
});

test('Küchenbon: Artikel, Extras, Notizen – keine Preise', () => {
  const t = texts(kitchenTicket(order));
  for (const expected of ['#7  LIEFERUNG', 'Jürgen Müller · Rosdorf', '» 19:30 Uhr', '2x 220 Pizza Margherita 40cm', '+ Käserand', '» ohne Zwiebeln', '1x Fanta 1,0 l', '3 Artikel']) {
    assert.ok(t.includes(expected), `fehlt: ${expected}`);
  }
  assert.ok(!t.some((x) => /\d,\d\d( €)?$/.test(x) && !/l$/.test(x)), 'keine Preise');
});

test('Tagesbericht und Testseite lassen sich aufbauen', () => {
  const t = texts(dayReport('2026-11-16', daySummary([order, { ...order, status: 'cancelled' }]), mergeSettings()));
  for (const expected of ['TAGESBERICHT 16.11.2026', 'UMSATZ', '45,05 €', 'Bar (1)', 'Lieferung (1)', 'Storniert (1)', '2x 220 Pizza Margherita 40cm']) {
    assert.ok(t.includes(expected), `fehlt: ${expected}`);
  }
  assert.ok(texts(testPage(mergeSettings(), 576)).includes('TESTDRUCK'));
});
