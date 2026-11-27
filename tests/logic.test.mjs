import test from 'node:test';
import assert from 'node:assert/strict';

import { compareNr, eur, fold, normPhone, parseEur } from '../js/lib/util.js';
import { ORDER_TYPES, checkoutProblems, canHalve, halfPrice, priceForSize, fmtMinutes, isOpenOrder, nextStage, orderDue, timeToday, autoDeliveryFee, zoneFee, categoryStation, daySummary, defaultSelection, entriesToSelection, extraLabel, extraPrice, lineTotal, missingSelection, orderTotals, sameLine, selectionEntries } from '../js/lib/order.js';
import { removableIngredients, sauceChoices } from '../tools/fetch-menu.mjs';
import { MENU_SCHEMA, makeLine, migrateMenu, seedMenu } from '../js/lib/store.js';
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
  assert.equal(PRODUCTS.length, 164);
  assert.ok(!PRODUCTS.some((p) => p.name === 'hausgemachtes Joghurtdressing'), 'Joghurtdressing unter Pizzabrötchen entfernt');
  assert.ok(!CATEGORIES.some((c) => c.name === 'Pizzabrötchen Extra'), 'leere Kategorie entfällt');
  assert.equal(CATEGORIES.find((c) => c.name === 'Pizzabrötchen').extras, null);
  assert.equal(CATEGORIES.length, 13);
  assert.deepEqual(byNr('220')[0].v, [['30cm', 950], ['40cm', 1740], ['40x60cm', 2790]]);
  assert.equal(byNr('220')[0].name, 'Pizza Margherita');
  assert.equal(byNr('221a')[0].name, 'Pizza Andy');
  assert.equal(byNr('100')[0].name, 'Hamburger');
  assert.equal(byNr('108').length, 1, 'doppelter Eintrag der Quelle nur einmal');
  assert.equal(byNr('349')[0].v[0][1], 1790);
  // eigener Artikel (nicht bei bringstar)
  const joghurt = PRODUCTS.find((p) => p.id === 'joghurt-gross');
  assert.deepEqual([joghurt.name, joghurt.v, CATEGORIES.find((c) => c.id === joghurt.cat).name], ['Joghurt groß', [['', 250]], 'Beilagen']);
  const klein = PRODUCTS.find((p) => p.id === 'joghurt-klein');
  assert.deepEqual([klein.name, klein.v, klein.cat], ['Joghurt klein', [['', 150]], joghurt.cat]);
  assert.equal(PRODUCTS.indexOf(klein) + 1, PRODUCTS.indexOf(joghurt), 'klein direkt vor groß');
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
  assert.deepEqual(CATEGORIES.filter((c) => c.station === 'pizza').map((c) => c.name), ['Pizza', 'Extras (Pizza)', 'Calzone', 'Pizzabrötchen']);
  assert.deepEqual(CATEGORIES.filter((c) => c.station === 'none').map((c) => c.name), ['Getränke'], 'Getränke auf keinem Küchenbon');
  assert.ok(CATEGORIES.every((c) => ['pizza', 'kitchen', 'none'].includes(c.station)));
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

test('Burger: Pommes-Wahl (Standard Twister) und abwählbare Zutaten', () => {
  const burgers = PRODUCTS.filter((p) => p.cat === CATEGORIES.find((c) => c.name === 'XXL Burger').id);
  assert.equal(burgers.length, 17);
  for (const b of burgers) {
    const [pommes, ohne] = b.opts;
    assert.deepEqual(pommes, { name: 'Pommes', type: 'one', prefix: 'mit', default: 0, choices: [['Twister Pommes', 0], ['Pommes', 0]] }, b.name);
    assert.equal(ohne.type, 'many');
    assert.equal(ohne.prefix, 'ohne');
    assert.ok(ohne.choices.length >= 3, b.name);
    for (const [name] of ohne.choices) assert.ok(!/[(),]|pommes|rindfleisch/i.test(name), `${b.name}: ${name}`);
  }
  const ohne = (name) => PRODUCTS.find((p) => p.name === name).opts[1].choices.map((c) => c[0]);
  assert.deepEqual(ohne('Cheesehamburger'), ['Sauce', 'Salat', 'Ketchup', 'Tomaten', 'Gurken', 'Zwiebeln', 'Käse']);
  assert.deepEqual(ohne('Holstein-Burger'), ['Spiegeleier', 'Sauce', 'Salat', 'Tomaten', 'Gurken', 'Zwiebeln']);
  assert.deepEqual(ohne('Gyros-Burger'), ['Zaziki', 'Krautsalat', 'Zwiebeln']);
  assert.deepEqual(removableIngredients('mit 2x 180g Rindfleisch (100%), hausgemachter Sauce (c,j), roten Zwiebeln und Twister Pommes'), ['Sauce', 'Zwiebeln']);
  // Extras-Kategorie der Burger bekommt keine Auswahl
  assert.ok(PRODUCTS.filter((p) => p.cat === CATEGORIES.find((c) => c.name === 'Extras Burger').id).every((p) => !p.opts));
});

test('Gyros: Twister Pommes für 1,50 € Aufpreis, Nuggets/Wings: Sauce Pflicht', () => {
  const gyros = PRODUCTS.filter((p) => p.cat === CATEGORIES.find((c) => c.name === 'Gyros vom Spieß').id);
  assert.equal(gyros.length, 11);
  for (const g of gyros) assert.deepEqual(g.opts, [{ name: 'Pommes', type: 'one', prefix: 'mit', default: 0, choices: [['Pommes', 0], ['Twister Pommes', 150]] }]);
  for (const name of ['Nuggets mit Twister Pommes', 'Wings mit Twister Pommes']) {
    assert.deepEqual(PRODUCTS.find((p) => p.name === name).opts, [
      { name: 'Sauce', type: 'one', prefix: 'mit', required: true, choices: [['Joghurtsauce', 0], ['BBQ-Sauce', 0], ['Süß-sauer-Sauce', 0], ['Chilisauce', 0]] },
    ]);
  }
  assert.equal(PRODUCTS.find((p) => p.name === 'Chicken Teller').opts, undefined);
  assert.deepEqual(sauceChoices('Wahlweise mit A / B-Sauce /C'), ['A', 'B-Sauce', 'C']);
  assert.deepEqual(sauceChoices('ohne Auswahl'), []);
  // Sonst hat kein Artikel Auswahlgruppen
  // Salate: Dressing Pflicht (Krautsalat hat keine Wahl)
  const salads = PRODUCTS.filter((p) => p.cat === CATEGORIES.find((c) => c.name === 'Salat').id);
  for (const s of salads.filter((p) => p.name !== 'Krautsalat')) {
    assert.deepEqual(s.opts, [{ name: 'Dressing', type: 'one', prefix: 'Dressing:', required: true, choices: [['Joghurtdressing', 0], ['Essig+Öl', 0], ['scharfes Dressing', 0]] }], s.name);
  }
  assert.equal(PRODUCTS.find((p) => p.name === 'Krautsalat').opts, undefined);
  assert.equal(extraLabel({ name: 'Essig+Öl', price: 0, prefix: 'Dressing:' }), 'Dressing: Essig+Öl');
  // Sonst hat kein Artikel Auswahlgruppen
  assert.equal(PRODUCTS.filter((p) => p.opts).length, 17 + 11 + 2 + 10);
});

test('Auswahl: Vorgabe, Einträge auf der Position, Bearbeiten, Pflichtfelder', () => {
  const opts = [
    { name: 'Pommes', type: 'one', prefix: 'mit', default: 0, choices: [['Pommes', 0], ['Twister Pommes', 150]] },
    { name: 'Sauce', type: 'one', prefix: 'mit', required: true, choices: [['BBQ', 0], ['Chili', 0]] },
    { name: 'Ohne', type: 'many', prefix: 'ohne', choices: [['Tomaten', 0], ['Gurken', 0], ['Zwiebeln', 0]] },
  ];
  const sel = defaultSelection(opts);
  assert.equal(sel.Pommes, 0);
  assert.equal(sel.Sauce, null);
  assert.deepEqual([...sel.Ohne], []);
  assert.deepEqual(missingSelection(opts, sel), ['Sauce']);
  Object.assign(sel, { Pommes: 1, Sauce: 0, Ohne: new Set(['Zwiebeln', 'Tomaten']) });
  assert.deepEqual(missingSelection(opts, sel), []);
  const entries = selectionEntries(opts, sel);
  assert.deepEqual(entries, [
    { name: 'Twister Pommes', price: 150, group: 'Pommes', prefix: 'mit' },
    { name: 'BBQ', price: 0, group: 'Sauce', prefix: 'mit' },
    { name: 'Tomaten', price: 0, group: 'Ohne', prefix: 'ohne' },
    { name: 'Zwiebeln', price: 0, group: 'Ohne', prefix: 'ohne' },
  ]);
  assert.deepEqual(entries.map(extraLabel), ['mit Twister Pommes', 'mit BBQ', 'ohne Tomaten', 'ohne Zwiebeln']);
  assert.equal(extraLabel({ name: 'Käserand', price: 250 }), '+ Käserand');
  // Zurück in die Auswahl (Position bearbeiten)
  const back = entriesToSelection(opts, [...entries, { name: 'Käserand', price: 250 }]);
  assert.equal(back.Pommes, 1);
  assert.equal(back.Sauce, 0);
  assert.deepEqual([...back.Ohne].sort(), ['Tomaten', 'Zwiebeln']);
  // Preis: Aufpreis zählt, "ohne" kostet nichts
  assert.equal(lineTotal({ unitPrice: 1390, qty: 2, extras: entries }), 2 * 1540);
  // "ohne Zwiebeln" und "+ Zwiebeln" sind verschiedene Positionen
  const l = (extras) => ({ productId: 1, name: 'X', variant: '', unitPrice: 100, qty: 1, tax: 7, note: '', extras });
  assert.ok(!sameLine(l([{ name: 'Zwiebeln', price: 0, prefix: 'ohne' }]), l([{ name: 'Zwiebeln', price: 0 }])));
});

test('Küchenbon-Station der Kategorien', () => {
  assert.equal(categoryStation({ name: 'Getränke' }), 'none');
  assert.equal(categoryStation({ name: 'Getränke', station: 'kitchen' }), 'kitchen', 'von Hand umgestellt');
  assert.equal(categoryStation({ name: 'Calzone' }), 'pizza');
  assert.equal(categoryStation({ name: 'Salat' }), 'kitchen');
});

test('Von Hand geänderte Speisekarte bekommt die neuen Auswahlmöglichkeiten, eigene Änderungen bleiben', () => {
  const seed = seedMenu();
  // Stand vor dieser Version: keine Auswahlgruppen, Getränke an der Küchenseite, ein Preis geändert, ein Artikel gelöscht
  const old = JSON.parse(JSON.stringify(seed));
  delete old.schema;
  old.edited = true;
  for (const p of old.products) delete p.opts;
  old.products = old.products.filter((p) => typeof p.id === 'number' && p.name !== 'Hamburger');
  old.categories.find((c) => c.name === 'Getränke').station = 'kitchen';
  old.products.find((p) => p.name === 'Cheesehamburger').v[0][1] = 1350;
  old.products.push({ id: 'peigen', cat: 258, nr: '199', name: 'Haus-Burger', desc: '', v: [['', 1500]], active: true });

  const m = migrateMenu(old, seed);
  assert.equal(m.schema, MENU_SCHEMA);
  assert.equal(m.edited, true);
  const cheese = m.products.find((p) => p.name === 'Cheesehamburger');
  assert.equal(cheese.v[0][1], 1350, 'eigener Preis bleibt');
  assert.equal(cheese.opts[0].name, 'Pommes');
  assert.ok(!m.products.some((p) => p.name === 'Hamburger'), 'gelöschter Artikel kommt nicht zurück');
  assert.ok(m.products.some((p) => p.name === 'Haus-Burger' && !p.opts), 'eigener Artikel bleibt');
  assert.equal(m.categories.find((c) => c.name === 'Getränke').station, 'none');
  for (const p of seed.products.filter((p) => typeof p.id === 'string')) assert.ok(m.products.some((x) => x.id === p.id), `neuer Artikel ${p.name}`);
  // Aktueller Stand bleibt unverändert
  assert.equal(migrateMenu(seed, seed), seed);

  // Stand nach der vorigen Version (2): Salate bekommen das Dressing, eigene Entscheidungen von damals bleiben
  const v2 = JSON.parse(JSON.stringify(seed));
  v2.schema = 2;
  v2.edited = true;
  for (const p of v2.products) if (/^Salat$/.test(v2.categories.find((c) => c.id === p.cat).name)) delete p.opts;
  v2.products = v2.products.filter((p) => p.id !== 'joghurt-gross'); // bewusst gelöscht
  v2.categories.find((c) => c.name === 'Getränke').station = 'kitchen'; // bewusst zurückgestellt
  const m3 = migrateMenu(v2, seed);
  assert.equal(m3.products.find((p) => p.name === 'Bauernsalat').opts[0].name, 'Dressing');
  assert.ok(!m3.products.some((p) => p.id === 'joghurt-gross'), 'gelöschter eigener Artikel kommt nicht zurück');
  assert.equal(m3.categories.find((c) => c.name === 'Getränke').station, 'kitchen');
  assert.ok(m3.products.some((p) => p.id === 'joghurt-klein'), 'Joghurt klein kommt dazu (neu in Stufe 4)');

  // Stand nach Stufe 3: Joghurt klein kommt dazu, und zwar direkt vor Joghurt groß
  const v3 = JSON.parse(JSON.stringify(seed));
  v3.schema = 3;
  v3.edited = true;
  v3.products = v3.products.filter((p) => p.id !== 'joghurt-klein');
  const m4 = migrateMenu(v3, seed);
  const ids = m4.products.map((p) => p.id);
  assert.equal(ids.indexOf('joghurt-klein') + 1, ids.indexOf('joghurt-gross'));
  assert.equal(m4.products.length, seed.products.length);
  // ... aber nicht, wenn der Artikel nach Stufe 4 gelöscht wurde
  const v5 = { ...m4, products: m4.products.filter((p) => p.id !== 'joghurt-klein') };
  assert.equal(migrateMenu(v5, seed), v5);

  // Stand nach Stufe 4: Joghurtdressing (bringstar) unter "Pizzabrötchen Extra" wird entfernt, die leere Kategorie entfällt
  const v4 = JSON.parse(JSON.stringify(seed));
  v4.schema = 4;
  v4.edited = true;
  v4.categories.push({ id: 272, name: 'Pizzabrötchen Extra', tax: 7, isExtras: true, station: 'pizza', extras: null });
  v4.categories.find((c) => c.name === 'Pizzabrötchen').extras = 272;
  v4.products.push({ id: 12450, cat: 272, nr: '', name: 'hausgemachtes Joghurtdressing', desc: '', v: [['', 150]], active: true });
  const m5 = migrateMenu(v4, seed);
  assert.ok(!m5.products.some((p) => p.id === 12450));
  assert.ok(!m5.categories.some((c) => c.id === 272));
  assert.equal(m5.categories.find((c) => c.name === 'Pizzabrötchen').extras, null);
  // Hat jemand weitere eigene Artikel in diese Kategorie gelegt, bleibt sie
  const keep = JSON.parse(JSON.stringify(v4));
  keep.products.push({ id: 'peigen2', cat: 272, nr: '', name: 'Knoblauchsauce', desc: '', v: [['', 100]], active: true });
  const k5 = migrateMenu(keep, seed);
  assert.ok(k5.categories.some((c) => c.id === 272) && k5.categories.find((c) => c.name === 'Pizzabrötchen').extras === 272);
  assert.ok(!k5.products.some((p) => p.id === 12450));
});

test('Liefergebiete: Lieferkosten nach Ort des Kunden', () => {
  const zones = mergeSettings(undefined).order.zones;
  assert.deepEqual(zones[0].places, ['Sieboldshausen', 'Niedernjesa', 'Dramfeld', 'Obernjesa', 'Stockhausen', 'Kleinschneen']);
  const fee = (city, zip = '') => zoneFee({ city, zip }, zones)?.fee ?? null;
  for (const city of ['Obernjesa', 'Rosdorf-Obernjesa', 'Rosdorf OT Dramfeld', 'Klein Schneen', 'Friedland-Kleinschneen', 'niedernjesa', 'Stockhausen', 'Sieboldshausen']) {
    assert.equal(fee(city), 180, city);
  }
  assert.equal(fee('Rosdorf'), null, 'Ort ohne Liefergebiet');
  assert.equal(fee('Göttingen'), null);
  assert.equal(fee(''), null);
  assert.equal(zoneFee({ city: 'Obernjesa' }, []), null);

  // Genauester Ortsname gewinnt, Ortsname schlägt PLZ
  const z = [
    { fee: 250, places: ['Rosdorf', '37085'] },
    { fee: 180, places: ['Obernjesa'] },
    { fee: 350, places: ['Göttingen'] },
  ];
  assert.deepEqual(zoneFee({ city: 'Rosdorf-Obernjesa', zip: '37124' }, z), { fee: 180, place: 'Obernjesa' });
  assert.deepEqual(zoneFee({ city: 'Rosdorf', zip: '37124' }, z), { fee: 250, place: 'Rosdorf' });
  assert.deepEqual(zoneFee({ city: 'Göttingen', zip: '37085' }, z), { fee: 350, place: 'Göttingen' });
  assert.deepEqual(zoneFee({ city: '', zip: '37085' }, z), { fee: 250, place: '37085' });
  assert.deepEqual(zoneFee({ city: 'Göttingen-Geismar', zip: '37083' }, z), { fee: 350, place: 'Göttingen' });

  // Rückfall: Lieferkosten der letzten Lieferung an diesen Kunden
  assert.deepEqual(autoDeliveryFee({ city: 'Obernjesa', lastFee: 350 }, zones), { fee: 180, source: 'zone', place: 'Obernjesa' });
  assert.deepEqual(autoDeliveryFee({ city: 'Rosdorf', lastFee: 250 }, zones), { fee: 250, source: 'customer' });
  assert.deepEqual(autoDeliveryFee({ city: 'Rosdorf', lastFee: 0 }, zones), { fee: 0, source: 'customer' });
  assert.deepEqual(autoDeliveryFee({ city: 'Rosdorf' }, zones), { fee: 0, source: 'none' });
});

test('Offene Bestellungen: Fälligkeit und Dringlichkeit', () => {
  const settings = mergeSettings(undefined).order;
  assert.deepEqual([settings.prepMinutes, settings.soonMinutes], [{ delivery: 45, pickup: 20 }, 10]);
  const at = (hhmm) => new Date(`2026-11-24T${hhmm}:00`);
  const o = (o) => ({ type: 'delivery', createdAt: at('18:00').toISOString(), dueAt: null, ...o });

  let d = orderDue(o(), settings, at('18:10'));
  assert.deepEqual([d.due.getTime(), d.left, d.elapsed, d.level, d.preorder], [at('18:45').getTime(), 35, 10, 'ok', false]);
  assert.equal(orderDue(o(), settings, at('18:35')).level, 'soon'); // noch 10 Min.
  assert.equal(orderDue(o(), settings, at('18:34')).level, 'ok'); // noch 11 Min.
  d = orderDue(o(), settings, at('18:52'));
  assert.deepEqual([d.left, d.level], [-7, 'late']);
  // Abholung: 20 Minuten
  assert.equal(orderDue(o({ type: 'pickup' }), settings, at('18:21')).level, 'late');
  // Vorbestellung: gewünschte Uhrzeit zählt; mehr als eine Stunde vorher grau ("pre")
  d = orderDue(o({ dueAt: at('20:00').toISOString() }), settings, at('18:10'));
  assert.deepEqual([d.due.getTime(), d.level, d.preorder], [at('20:00').getTime(), 'pre', true]);
  assert.equal(orderDue(o({ dueAt: at('20:00').toISOString() }), settings, at('19:30')).level, 'ok');
  assert.equal(orderDue(o({ dueAt: at('20:00').toISOString() }), settings, at('19:55')).level, 'soon');
  // Eigene Zielzeiten
  assert.equal(orderDue(o(), { prepMinutes: { delivery: 30 }, soonMinutes: 5 }, at('18:26')).level, 'soon');
  assert.equal(orderDue(o(), { prepMinutes: { delivery: 30 }, soonMinutes: 5 }, at('18:24')).level, 'ok');
});

test('Offene Bestellungen: Ablauf, Uhrzeit, Anzeige', () => {
  assert.deepEqual(nextStage({ stage: 'kitchen', type: 'delivery' }), { stage: 'out', label: 'Unterwegs' });
  assert.deepEqual(nextStage({ stage: 'kitchen', type: 'pickup' }), { stage: 'ready', label: 'Abholbereit' });
  assert.deepEqual(nextStage({ stage: 'out' }), { stage: 'done', label: 'Geliefert' });
  assert.deepEqual(nextStage({ stage: 'ready' }), { stage: 'done', label: 'Abgeholt' });
  assert.equal(nextStage({ stage: 'done' }), null);
  assert.ok(isOpenOrder({ status: 'done', stage: 'kitchen' }));
  assert.ok(isOpenOrder({ status: 'done', stage: 'out' }));
  assert.ok(!isOpenOrder({ status: 'done', stage: 'done' }));
  assert.ok(!isOpenOrder({ status: 'cancelled', stage: 'kitchen' }));
  assert.ok(!isOpenOrder({ status: 'done' }), 'Bestellungen aus älteren Versionen gelten als erledigt');
  const now = new Date('2026-11-24T17:00:00');
  assert.equal(timeToday('19:30', now).getTime(), new Date('2026-11-24T19:30:00').getTime());
  assert.equal(timeToday('7:05', now).getHours(), 7);
  assert.equal(timeToday('', now), null);
  assert.equal(timeToday('25:00', now), null);
  assert.deepEqual([5, 59, 60, 75, 120, -12].map(fmtMinutes), ['5 Min.', '59 Min.', '1 Std.', '1 Std. 15 Min.', '2 Std.', '12 Min.']);
});

test('Pizza halb/halb: Preis, Größe, Position', () => {
  assert.equal(halfPrice(1070, 1050), 1070, 'teurere Hälfte');
  assert.equal(halfPrice(1070, 1140, 'max'), 1140);
  assert.equal(halfPrice(1070, 1140, 'avg'), 1110, 'Durchschnitt 11,05 -> 11,10');
  assert.equal(halfPrice(1000, 1200, 'avg'), 1100);
  const salami = PRODUCTS.find((p) => p.nr === '223');
  const funghi = PRODUCTS.find((p) => p.nr === '222');
  assert.equal(priceForSize(funghi, '40cm'), 1950);
  assert.equal(priceForSize(funghi, 'gibtsnicht', 2), 3090, 'sonst gleiche Stelle');
  assert.equal(priceForSize({ v: [['', 500]] }, '40cm', 1), null);
  assert.ok(canHalve({ name: 'Pizza' }));
  assert.ok(!canHalve({ name: 'Calzone' }) && !canHalve({ name: 'Pizzabrötchen' }) && !canHalve(undefined));
  assert.ok(canHalve({ name: 'Calzone', halves: true }), 'per Kategorie einstellbar');

  const l = makeLine(salami, 1, { half: funghi, extras: [{ name: 'Käserand', price: 250 }], note: 'gut durch' });
  assert.deepEqual(
    [l.name, l.nr, l.variant, l.unitPrice, l.productId, l.halves, l.extras.length, l.note],
    ['Pizza halb/halb', '', '40cm', 1990, salami.id, [{ productId: salami.id, nr: '223', name: 'Pizza Salami' }, { productId: funghi.id, nr: '222', name: 'Pizza Funghi' }], 1, 'gut durch'],
  );
  assert.equal(lineTotal(l), 2240);
  // ohne zweite Hälfte: normale Position
  assert.equal(makeLine(salami, 1).halves, undefined);
  // halb/halb ist eine andere Position als eine normale Salami bzw. eine andere Kombination
  assert.ok(!sameLine(l, makeLine(salami, 1, { extras: l.extras, note: 'gut durch' })));
  const other = makeLine(salami, 1, { half: PRODUCTS.find((p) => p.nr === '224'), extras: l.extras, note: 'gut durch' });
  assert.ok(!sameLine({ ...l, unitPrice: 0 }, { ...other, unitPrice: 0 }));
  assert.ok(sameLine(l, { ...makeLine(salami, 1, { half: funghi, extras: l.extras, note: 'gut durch' }), key: 'x' }));
});

test('Abschluss: Rückfrage nur, wenn etwas fehlt', () => {
  const now = new Date('2026-11-27T18:00:00');
  const ok = { type: 'delivery', customer: { street: 'Am Markt 3' }, dueTime: '' };
  assert.deepEqual(checkoutProblems(ok, { deliveryFee: 180 }, now), []);
  assert.deepEqual(checkoutProblems({ ...ok, customer: null }, { deliveryFee: 180 }, now), ['Es ist keine Lieferadresse ausgewählt.']);
  assert.deepEqual(checkoutProblems(ok, { deliveryFee: 0 }, now), ['Es sind keine Lieferkosten berechnet.']);
  assert.deepEqual(checkoutProblems({ ...ok, dueTime: '17:30' }, { deliveryFee: 180 }, now), ['Die Uhrzeit 17:30 Uhr ist schon vorbei.']);
  assert.deepEqual(checkoutProblems({ ...ok, dueTime: '19:30' }, { deliveryFee: 180 }, now), []);
  // Abholung: Adresse und Lieferkosten egal
  assert.deepEqual(checkoutProblems({ type: 'pickup', customer: null, dueTime: '' }, { deliveryFee: 0 }, now), []);
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
  assert.equal(mergeSettings({ printer: { driver: 'webprnt' } }).printer.kitchenSize, 'large');
  assert.equal(mergeSettings(undefined).printer.customerCopies, 2);
  assert.equal(mergeSettings({ printer: { driver: 'webprnt' } }).printer.customerCopies, 2, 'auch bei schon gespeicherten Einstellungen');
  // Stände aus der ersten Version werden angeglichen, eigene Werte bleiben
  const migrated = mergeSettings({ order: { deliveryFees: [0, 100, 200, 300], defaultType: 'dinein' } }).order;
  assert.deepEqual([migrated.defaultType, migrated.deliveryFees, migrated.deliveryTax], ['delivery', [180, 250, 350], 7]);
  assert.deepEqual(migrated.zones.map((z) => z.fee), [180, 250, 350], 'Liefergebiete auch bei schon gespeicherten Einstellungen');
  assert.deepEqual(mergeSettings({ order: { deliveryFees: [150, 400] } }).order.deliveryFees, [150, 400]);
});
