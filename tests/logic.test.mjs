import test from 'node:test';
import assert from 'node:assert/strict';

import { compareNr, eur, fold, normPhone, parseEur } from '../js/lib/util.js';
import { ORDER_TYPES, daySummary, extraPrice, lineTotal, orderTotals, sameLine } from '../js/lib/order.js';
import { CATEGORIES, PRODUCTS } from '../js/data/menu.js';
import { mergeSettings } from '../js/data/defaults.js';

test('Geldbeträge formatieren und lesen', () => {
  assert.equal(eur(950), '9,50 €');
  assert.equal(eur(123456), '1.234,56 €');
  assert.equal(eur(5, { symbol: false }), '0,05');
  assert.equal(eur(-250), '-2,50 €');
  assert.equal(parseEur('12,50'), 1250);
  assert.equal(parseEur('12.5'), 1250);
  assert.equal(parseEur('1.234,50 €'), 123450);
  assert.equal(parseEur('7'), 700);
  assert.equal(parseEur(''), null);
  assert.equal(parseEur('abc'), null);
  assert.equal(parseEur('19,99'), 1999); // keine Rundungsfehler
});

test('Telefonnummern und Suchtext vereinheitlichen', () => {
  assert.equal(normPhone('+49 5509 999440'), '05509999440');
  assert.equal(normPhone('0049 5509/9994-40'), '05509999440');
  assert.equal(normPhone('05509 999 440'), '05509999440');
  assert.equal(normPhone(''), '');
  assert.equal(fold('Straße Müller É'), 'strasse muller e');
});

test('Artikelnummern sortieren', () => {
  assert.deepEqual(['222', '221a', '', '100', '221'].sort(compareNr), ['100', '221', '221a', '222', '']);
});

test('Speisekarte: Artikelnummern und Preise aus dem Import', () => {
  const byNr = (nr) => PRODUCTS.filter((p) => p.nr === nr);
  assert.equal(PRODUCTS.length, 163);
  assert.equal(CATEGORIES.length, 14);
  assert.deepEqual(byNr('220')[0].v, [['30cm', 950], ['40cm', 1740], ['40x60cm', 2790]]);
  assert.equal(byNr('220')[0].name, 'Pizza Margherita');
  assert.equal(byNr('221a')[0].name, 'Pizza Andy');
  assert.equal(byNr('100')[0].name, 'Hamburger');
  assert.equal(byNr('108').length, 1, 'doppelter Eintrag der Quelle nur einmal');
  assert.equal(byNr('349')[0].v[0][1], 1790);
  // Jede Artikelnummer ist eindeutig, jeder Artikel hat einen Preis und eine bekannte Kategorie.
  const numbered = PRODUCTS.filter((p) => p.nr).map((p) => p.nr);
  assert.equal(new Set(numbered).size, numbered.length);
  for (const p of PRODUCTS) {
    assert.ok(p.v.length > 0 && p.v.every(([, c]) => Number.isInteger(c) && c > 0), p.name);
    assert.ok(CATEGORIES.some((c) => c.id === p.cat), p.name);
  }
  const cat = (name) => CATEGORIES.find((c) => c.name === name);
  assert.equal(cat('Getränke').tax, 19);
  assert.equal(cat('Pizza').tax, 7);
  assert.equal(cat('Pizza').extras, cat('Extras (Pizza)').id);
  assert.equal(cat('Calzone').extras, cat('Extras (Pizza)').id);
  assert.equal(cat('XXL Burger').extras, cat('Extras Burger').id);
  assert.equal(cat('Extras Burger').extras, null);
  // Küchenbon-Station: alles rund um Pizza an die Pizzaseite, der Rest an die Küchenseite
  assert.deepEqual(CATEGORIES.filter((c) => c.station === 'pizza').map((c) => c.name), ['Pizza', 'Extras (Pizza)', 'Calzone', 'Pizzabrötchen', 'Pizzabrötchen Extra']);
  assert.ok(CATEGORIES.every((c) => c.station === 'pizza' || c.station === 'kitchen'));
});

test('Speisekarte: Tippfehler der Quelle sind korrigiert', () => {
  const all = PRODUCTS.flatMap((p) => [p.name, p.desc, ...p.v.map((v) => v[0])]).join('\n');
  for (const typo of ['Ananans', 'Staggioni', 'Meditarrene', 'Speiegelei', 'Röstzwiebelen', 'Schmlezkäse', 'Cheesburger', 'Mayonaise', 'knackigerSalat', 'mir Käse', 'Wasser Stil', '0,5 ml', 'Chilli', 'Tzaziki', 'Jalapenos']) {
    assert.ok(!all.includes(typo), `noch enthalten: ${typo}`);
  }
  const names = PRODUCTS.map((p) => p.name);
  for (const name of ['Pizza Quattro Stagioni', 'Pizza Mediterrane', 'Spiegelei', 'Röstzwiebeln', 'Chili-Cheeseburger', 'BBQ-Bacon-Cheeseburger', 'Wasser still', 'Gyros (2) mit Zaziki']) {
    assert.ok(names.includes(name), `fehlt: ${name}`);
  }
  assert.deepEqual(PRODUCTS.find((p) => p.name === 'Wasser still').v, [['0,5 l', 175]]);
  assert.deepEqual(PRODUCTS.find((p) => p.name === 'Artischocken').v.map((v) => v[0]), ['30cm', '40cm', '40x60cm']);
});

test('Bestellarten: nur Lieferung und Abholung', () => {
  assert.deepEqual(Object.keys(ORDER_TYPES), ['delivery', 'pickup']);
});

test('Extras richten sich nach der Größe', () => {
  const pizza = PRODUCTS.find((p) => p.nr === '220');
  const calzone = PRODUCTS.find((p) => p.nr === '260');
  const extra = (name) => PRODUCTS.find((p) => p.name === name);
  assert.equal(extraPrice(extra('Zwiebeln'), pizza, 0), 150);
  assert.equal(extraPrice(extra('Zwiebeln'), pizza, 1), 250);
  assert.equal(extraPrice(extra('Gyros (2)'), pizza, 2), 500);
  assert.equal(extraPrice(extra('Käserand'), pizza, 2), 250, 'Einheitspreis');
  assert.equal(extraPrice(extra('Artischocken'), pizza, 1), 250);
  assert.equal(extraPrice(extra('Thunfisch'), calzone, 0), 200, 'Calzone = 30cm');
});

const line = (o) => ({ productId: 1, name: 'X', variant: '', unitPrice: 1000, qty: 1, tax: 7, extras: [], note: '', ...o });

test('Summen und Mehrwertsteuer', () => {
  const order = {
    type: 'delivery',
    deliveryFee: 200,
    lines: [
      line({ unitPrice: 1740, extras: [{ name: 'Käserand', price: 250 }, { name: 'Zwiebeln', price: 250 }] }),
      line({ unitPrice: 1290, qty: 2 }),
      line({ unitPrice: 325, tax: 19 }),
    ],
  };
  assert.equal(lineTotal(order.lines[0]), 2240);
  const t = orderTotals(order, { deliveryTax: 7 });
  assert.equal(t.items, 5145);
  assert.equal(t.total, 5345);
  assert.equal(t.count, 4);
  assert.deepEqual(t.taxes, [
    { rate: 7, gross: 5020, net: 4692, tax: 328 },
    { rate: 19, gross: 325, net: 273, tax: 52 },
  ]);
  // Summe der Steuerzeilen ergibt immer exakt den Gesamtbetrag
  assert.equal(t.taxes.reduce((s, x) => s + x.gross, 0), t.total);
  // Lieferkosten zählen nur bei Lieferung
  assert.equal(orderTotals({ ...order, type: 'pickup' }).total, 5145);
  assert.deepEqual(orderTotals({ type: 'pickup', lines: [] }), { items: 0, deliveryFee: 0, total: 0, count: 0, taxes: [] });
});

test('Gleiche Positionen werden zusammengefasst, abweichende nicht', () => {
  assert.ok(sameLine(line({ key: 'a' }), line({ key: 'b', qty: 3 })));
  assert.ok(!sameLine(line(), line({ note: 'ohne Zwiebeln' })));
  assert.ok(!sameLine(line(), line({ variant: '40cm' })));
  assert.ok(!sameLine(line(), line({ extras: [{ name: 'Käse', price: 200 }] })));
});

test('Tagesübersicht ignoriert stornierte Bestellungen', () => {
  const mk = (o) => ({ status: 'done', type: 'delivery', payment: 'cash', total: 1000, deliveryFee: 0, taxes: [{ rate: 7, gross: 1000, net: 935, tax: 65 }], lines: [line()], ...o });
  const s = daySummary([mk(), mk({ payment: 'card', type: 'pickup', total: 2000, taxes: [{ rate: 7, gross: 2000, net: 1869, tax: 131 }], lines: [line({ qty: 2 })] }), mk({ status: 'cancelled', total: 5000 })]);
  assert.equal(s.count, 2);
  assert.equal(s.total, 3000);
  assert.equal(s.cancelledCount, 1);
  assert.equal(s.cancelledTotal, 5000);
  assert.deepEqual(s.byPayment, { cash: { count: 1, total: 1000 }, card: { count: 1, total: 2000 } });
  assert.deepEqual(s.taxes, [{ rate: 7, gross: 3000, net: 2804, tax: 196 }]);
  assert.equal(s.products[0].qty, 3);
});

test('Einstellungen: gespeicherte Werte überschreiben Voreinstellungen, neue Felder bleiben', () => {
  const s = mergeSettings({ shop: { name: 'Test' }, printer: { driver: 'webprnt' } });
  assert.equal(s.shop.name, 'Test');
  assert.equal(s.shop.line1, 'Steintorstraße 1b');
  assert.equal(s.printer.driver, 'webprnt');
  assert.equal(s.printer.paper, 80);
  assert.equal(mergeSettings(undefined).order.defaultType, 'delivery');
  assert.deepEqual(mergeSettings(undefined).order.deliveryFees, [180, 250, 350]);
  assert.equal(mergeSettings(undefined).printer.mapsQr, true);
  assert.equal(mergeSettings(undefined).printer.customerCopies, 2);
  assert.equal(mergeSettings({ printer: { driver: 'webprnt' } }).printer.customerCopies, 2, 'auch bei schon gespeicherten Einstellungen');
  // Stände aus der ersten Version werden angeglichen, eigene Werte bleiben
  assert.deepEqual(mergeSettings({ order: { deliveryFees: [0, 100, 200, 300], defaultType: 'dinein' } }).order, { defaultType: 'delivery', deliveryFees: [180, 250, 350], deliveryTax: 7 });
  assert.deepEqual(mergeSettings({ order: { deliveryFees: [150, 400] } }).order.deliveryFees, [150, 400]);
});
