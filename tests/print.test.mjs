import test from 'node:test';
import assert from 'node:assert/strict';

import { buildRequest, bytesToBase64, drawerRequest, endpointUrl, envelope, packMono, parseResponse, paperNearEnd, statusMessages } from '../js/print/webprnt.js';
import { customerReceipt, dayReport, kitchenTickets, mapsUrl, testPage } from '../js/print/receipt.js';
import { monoToPng, parseJob } from '../tools/mock-printer.mjs';
import { mergeSettings } from '../js/data/defaults.js';
import { categoryStation, daySummary, lineStation } from '../js/lib/order.js';

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
    { nr: '220', name: 'Pizza Margherita', variant: '40cm', unitPrice: 1740, qty: 2, tax: 7, station: 'pizza', extras: [{ name: 'Käserand', price: 250 }], note: 'ohne Zwiebeln' },
    { nr: '101', name: 'Cheesehamburger', variant: '', unitPrice: 1290, qty: 1, tax: 7, station: 'kitchen', extras: [{ name: 'Bacon', price: 200 }], note: '' },
    { nr: '', name: 'Fanta', variant: '1,0 l', unitPrice: 325, qty: 1, tax: 19, station: 'none', extras: [], note: '' },
  ],
  note: '19:30 Uhr',
  itemsTotal: 5795,
  deliveryFee: 200,
  total: 5995,
  taxes: [
    { rate: 7, gross: 5670, net: 5299, tax: 371 },
    { rate: 19, gross: 325, net: 273, tax: 52 },
  ],
  payment: 'cash',
};
const texts = (blocks) => blocks.flatMap((b) => [b.text, b.left, b.right, ...(b.cells ?? []).map((c) => c.text)]).filter((t) => t != null);

test('Kundenbon enthält alle Angaben', () => {
  const t = texts(customerReceipt(order, mergeSettings({ shop: { taxId: 'St.-Nr. 20/123/45678' } })));
  for (const expected of [
    'Pizza Haus & mehr', 'Steintorstraße 1b', 'Tel. 05509 999440', 'St.-Nr. 20/123/45678', 'Bon-Nr. 42', '16.11.2026 18:32', 'LIEFERUNG  #7',
    'Jürgen Müller', 'Göttinger Straße 12a', '37124 Rosdorf', 'Hinweis: Hinterhaus', '» 19:30 Uhr',
    '2x 220 Pizza Margherita 40cm', '34,80', '+ Käserand', '5,00', '» ohne Zwiebeln', '1x Fanta 1,0 l', '3,25',
    '1x 101 Cheesehamburger', '12,90', '+ Bacon', 'Zwischensumme', '57,95', 'Lieferkosten', '2,00', 'SUMME', '59,95 €', 'Zahlung', 'Bar',
    '7 %', '52,99', '3,71', '56,70', '19 %', '2,73', '0,52', 'Guten Appetit!',
  ]) {
    assert.ok(t.includes(expected), `fehlt: ${expected}`);
  }
  assert.ok(!t.includes('STORNIERT'));
  assert.ok(texts(customerReceipt({ ...order, status: 'cancelled' }, mergeSettings())).includes('STORNIERT'));
  assert.ok(!t.includes('Rückgeld') && !t.includes('Gegeben'));
  // Abholung: keine Adresse, keine Lieferkosten
  const pickup = texts(customerReceipt({ ...order, type: 'pickup', deliveryFee: 0, total: 5795, payment: 'card' }, mergeSettings()));
  assert.ok(pickup.includes('ABHOLUNG  #7') && pickup.includes('Karte') && pickup.includes('Jürgen Müller'));
  assert.ok(!pickup.includes('Göttinger Straße 12a') && !pickup.includes('Lieferkosten'));
  // Bestellungen mit einer früher vorhandenen Bestellart lassen sich weiterhin drucken
  assert.ok(texts(customerReceipt({ ...order, type: 'dinein' }, mergeSettings())).includes('DINEIN  #7'));
});

test('Lieferbon trägt einen Google-Maps-QR-Code zur Adresse', () => {
  const url = 'https://www.google.com/maps/dir/?api=1&destination=G%C3%B6ttinger+Stra%C3%9Fe+12a%2C+37124+Rosdorf';
  assert.equal(mapsUrl(order.customer), url);
  assert.equal(new URL(url).searchParams.get('destination'), 'Göttinger Straße 12a, 37124 Rosdorf');
  assert.equal(mapsUrl({ name: 'Ohne Adresse', city: 'Rosdorf' }), '');
  assert.equal(mapsUrl(null), '');
  const qr = (o, s = mergeSettings()) => customerReceipt(o, s).filter((b) => b.t === 'qr');
  assert.deepEqual(qr(order).map((b) => b.data), [url]);
  // ... direkt unter der Adresse, vor den Artikeln
  const blocks = customerReceipt(order, mergeSettings());
  const pos = (pred) => blocks.findIndex(pred);
  assert.ok(pos((b) => b.text === '37124 Rosdorf') < pos((b) => b.t === 'qr') && pos((b) => b.t === 'qr') < pos((b) => b.left?.startsWith('2x 220')));
  assert.equal(qr({ ...order, type: 'pickup' }).length, 0, 'nicht bei Abholung');
  assert.equal(qr({ ...order, customer: { name: 'Laufkunde' } }).length, 0, 'nicht ohne Adresse');
  assert.equal(qr({ ...order, customer: null }).length, 0);
  assert.equal(qr(order, mergeSettings({ printer: { mapsQr: false } })).length, 0, 'abschaltbar');
  assert.equal(kitchenTickets(order).flat().filter((b) => b.t === 'qr').length, 0, 'nicht auf den Küchenbons');
});

test('Küchenbons: Pizzaseite und Küchenseite getrennt, mit Hinweis auf die andere Seite', () => {
  const o = {
    ...order,
    lines: [
      ...order.lines,
      {
        nr: '340', name: 'Gyros (2)', variant: '', unitPrice: 1390, qty: 1, tax: 7, station: 'kitchen', note: '',
        extras: [
          { name: 'Twister Pommes', price: 150, group: 'Pommes', prefix: 'mit' },
          { name: 'Zwiebeln', price: 0, group: 'Ohne', prefix: 'ohne' },
        ],
      },
    ],
  };
  const tickets = kitchenTickets(o);
  assert.equal(tickets.length, 2);
  const [pizza, kitchen] = tickets.map(texts);

  for (const expected of ['PIZZA  #7', 'LIEFERUNG', 'Jürgen Müller · Rosdorf', '» 19:30 Uhr', '2x 220 Pizza Margherita 40cm', '+ Käserand', '» ohne Zwiebeln', '2 Artikel', 'Außerdem bei KÜCHE:', '1x 101 Cheesehamburger', '1x 340 Gyros (2)']) {
    assert.ok(pizza.includes(expected), `Pizzaseite, fehlt: ${expected}`);
  }
  for (const expected of ['KÜCHE  #7', 'LIEFERUNG', '» 19:30 Uhr', '1x 101 Cheesehamburger', '+ Bacon', '1x 340 Gyros (2)', 'mit Twister Pommes', 'ohne Zwiebeln', '2 Artikel', 'Außerdem bei PIZZA:', '2x 220 Pizza Margherita 40cm']) {
    assert.ok(kitchen.includes(expected), `Küchenseite, fehlt: ${expected}`);
  }
  // Getränke stehen auf keinem Küchenbon
  for (const t of [pizza, kitchen]) assert.ok(!t.some((x) => /Fanta/.test(x)), 'keine Getränke');
  // Eigene Artikel groß, die der anderen Seite klein und ohne Extras/Notizen
  const size = (blocks, t) => blocks.find((b) => b.text === t)?.size;
  assert.equal(size(tickets[0], '2x 220 Pizza Margherita 40cm'), 'l');
  assert.equal(size(tickets[0], '1x 101 Cheesehamburger'), 's');
  assert.equal(size(tickets[1], '2x 220 Pizza Margherita 40cm'), 's');
  assert.equal(size(tickets[1], '1x 101 Cheesehamburger'), 'l');
  assert.equal(tickets[1].find((b) => b.text === 'ohne Zwiebeln')?.bold, true, '"ohne" fett');
  assert.ok(!kitchen.includes('+ Käserand') && !kitchen.includes('» ohne Zwiebeln') && !pizza.includes('+ Bacon') && !pizza.includes('mit Twister Pommes'));
  for (const t of [pizza, kitchen]) assert.ok(!t.some((x) => /\d,\d\d( €)?$/.test(x) && !/l$/.test(x)), 'keine Preise');

  // Kundenbon: Aufpreis mit Betrag, "ohne" ohne Betrag
  const rows = customerReceipt(o, mergeSettings()).filter((b) => b.t === 'row');
  assert.deepEqual(rows.find((b) => b.left === 'mit Twister Pommes')?.right, '1,50');
  assert.deepEqual(rows.find((b) => b.left === 'ohne Zwiebeln')?.right, '');
});

test('Küchenbons: nur Getränke -> kein Küchenbon', () => {
  assert.deepEqual(kitchenTickets({ ...order, lines: order.lines.filter((l) => l.station === 'none') }), []);
});

test('Küchenbons: nur die betroffene Seite bekommt einen Bon', () => {
  const only = (pred) => kitchenTickets({ ...order, lines: order.lines.filter(pred) });
  const pizzaOnly = only((l) => l.station === 'pizza');
  assert.equal(pizzaOnly.length, 1);
  assert.ok(texts(pizzaOnly[0]).includes('PIZZA  #7') && texts(pizzaOnly[0]).includes('Nichts bei Küche.'));
  const kitchenOnly = only((l) => l.station === 'kitchen');
  assert.equal(kitchenOnly.length, 1);
  assert.ok(texts(kitchenOnly[0]).includes('KÜCHE  #7') && texts(kitchenOnly[0]).includes('Nichts bei Pizza.'));
  assert.deepEqual(kitchenTickets({ ...order, lines: [] }), []);
});

test('Küchenbons: Station kommt von der Position, sonst von der Kategorie', () => {
  const categories = [
    { id: 1, name: 'Pizza' },
    { id: 2, name: 'Calzone' },
    { id: 3, name: 'Pizzabrötchen' },
    { id: 4, name: 'XXL Burger' },
    { id: 5, name: 'Salat', station: 'pizza' }, // in den Einstellungen umgestellt
    { id: 6, name: 'Pizza-Baguette', station: 'kitchen' },
  ];
  const l = (o) => ({ nr: '', name: 'X', variant: '', qty: 1, extras: [], ...o });
  categories.push({ id: 7, name: 'Getränke' });
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 99, null].map((catId) => lineStation(l({ catId }), categories)), ['pizza', 'pizza', 'pizza', 'kitchen', 'pizza', 'kitchen', 'none', 'kitchen', 'kitchen']);
  assert.equal(lineStation(l({ catId: 4, station: 'pizza' }), categories), 'pizza', 'an der Position gemerkt');
  assert.equal(categoryStation({ name: 'Extras (Pizza)' }), 'pizza');
  assert.equal(categoryStation({ name: 'Getränke' }), 'none');
  assert.equal(categoryStation(undefined), 'kitchen');
  const [pizza] = kitchenTickets({ ...order, lines: [l({ catId: 2, name: 'Calzone Salami' }), l({ catId: 4, name: 'Hamburger' })] }, categories);
  assert.ok(texts(pizza).includes('1x Calzone Salami') && texts(pizza).includes('Außerdem bei KÜCHE:'));
});

test('Tagesbericht und Testseite lassen sich aufbauen', () => {
  const t = texts(dayReport('2026-11-16', daySummary([order, { ...order, status: 'cancelled' }]), mergeSettings()));
  for (const expected of ['TAGESBERICHT 16.11.2026', 'UMSATZ', '59,95 €', 'Bar (1)', 'Lieferung (1)', 'Storniert (1)', '2x 220 Pizza Margherita 40cm']) {
    assert.ok(t.includes(expected), `fehlt: ${expected}`);
  }
  assert.ok(texts(testPage(mergeSettings(), 576)).includes('TESTDRUCK'));
});
