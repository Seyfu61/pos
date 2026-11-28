#!/usr/bin/env node
// Liest die Speisekarte von bringstar.jetzt aus und erzeugt js/data/menu.js neu.
//
//   node tools/fetch-menu.mjs                 (lädt die Seite)
//   node tools/fetch-menu.mjs seite.html      (nutzt eine gespeicherte HTML-Datei)
//
// Achtung: In der App geänderte Preise/Artikel bleiben erhalten, bis in den
// Einstellungen "Speisekarte zurücksetzen" gewählt wird.

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { stripAllergens } from '../js/lib/util.js';

const SOURCE_URL = 'https://bringstar.jetzt/rosdorf/pizza-haus-mehr-obernjesa/lieferservice';
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'js', 'data', 'menu.js');

// Welche Kategorie liefert die Extras für welche Kategorie (Zuordnung über den Namen).
const EXTRAS_RULES = [
  { extras: /^extras \(pizza\)$/i, for: /^(pizza|calzone|pizzabrötchen)$/i },
  { extras: /^extras burger$/i, for: /burger$/i },
  { extras: /^pasta extras$/i, for: /^pasta$/i },
];
const DRINKS = /getränk/i; // 19 % MwSt., alles andere 7 %
const PIZZA_STATION = /pizza|calzone/i; // Küchenbon "Pizzaseite"
const NO_STATION = DRINKS; // erscheinen auf keinem Küchenbon; alles andere geht an die Küchenseite

// --- Auswahlmöglichkeiten je Artikel ------------------------------------------------------
// Gruppen: { name, type: 'one' (genau eine Wahl) | 'many' (beliebig viele), prefix (Text auf dem Bon),
//            default (vorausgewählt), required (ohne Wahl kein Hinzufügen), choices: [[Name, Aufpreis in Cent]] }

const MAIN_INGREDIENT = /rindfleisch|pommes|chicken|nuggets|^gyros/i; // gehört zum Gericht, nicht abwählbar
const ADJECTIVE = /^(knackige[rn]?|rote[n]?|hausgemachte[rn]?|gebratene[rn]?|scharfe[n]?|frische[n]?)\s+/i;
const INGREDIENT_FIXES = { '2 Spiegeleiern': 'Spiegeleier' };

/** Zutaten aus der Beschreibung, die man weglassen kann ("mit 180g Rindfleisch, Ketchup, Tomaten und Twister Pommes"). */
export function removableIngredients(desc) {
  const out = [];
  // Allergen-Angaben in Klammern zuerst entfernen – sie enthalten selbst Kommas.
  const text = String(desc ?? '').replace(/\([^)]*\)/g, '').replace(/^mit\s+/i, '');
  for (let part of text.split(/,\s*|\s+und\s+/)) {
    part = part.replace(/\s+/g, ' ').trim();
    part = INGREDIENT_FIXES[part] ?? part.replace(ADJECTIVE, '');
    if (!part || MAIN_INGREDIENT.test(part)) continue;
    part = part[0].toUpperCase() + part.slice(1);
    if (!out.includes(part)) out.push(part);
  }
  return out;
}

/** Saucen aus "Wahlweise mit A / B / C". */
export function sauceChoices(desc) {
  const m = /wahlweise mit (.+)$/i.exec(String(desc ?? ''));
  return m ? m[1].split(/\s*\/\s*/).map((s) => s.trim()).filter(Boolean) : [];
}

const OPTION_RULES = [
  {
    cat: /burger$/i, // "XXL Burger" (die Kategorie "Extras Burger" ist eine Extras-Kategorie und wird übersprungen)
    build: (item) => [
      { name: 'Pommes', type: 'one', prefix: 'mit', default: 0, choices: [['Twister Pommes', 0], ['Pommes', 0]] },
      { name: 'Ohne', type: 'many', prefix: 'ohne', choices: removableIngredients(item.desc).map((i) => [i, 0]) },
    ],
  },
  {
    cat: /^gyros/i,
    build: () => [{ name: 'Pommes', type: 'one', prefix: 'mit', default: 0, choices: [['Pommes', 0], ['Twister Pommes', 150]] }],
  },
  {
    cat: /nuggets|wings/i,
    build: (item) => [{ name: 'Sauce', type: 'one', prefix: 'mit', required: true, choices: sauceChoices(item.desc).map((s) => [s, 0]) }],
  },
  {
    cat: /^salat$/i,
    build: (item) => [{ name: 'Dressing', type: 'one', prefix: 'Dressing:', required: true, choices: sauceChoices(item.desc).map((s) => [s, 0]) }],
  },
];

function buildOptions(cat, item) {
  if (cat.isExtras) return [];
  const rule = OPTION_RULES.find((r) => r.cat.test(cat.name));
  return rule ? rule.build(item).filter((g) => g.choices.length > (g.type === 'one' ? 1 : 0)) : [];
}

// Artikel von bringstar, die in der Kasse nicht vorkommen sollen (Name, exakt).
// Kategorien, die dadurch leer werden, entfallen ebenfalls.
const EXCLUDED_PRODUCTS = [
  'hausgemachtes Joghurtdressing', // ersetzt durch "Joghurt klein" / "Joghurt groß" unter Beilagen
];

// Artikel, die es bei bringstar nicht gibt (feste IDs, damit Bestellungen und Änderungen zuordenbar bleiben).
const LOCAL_PRODUCTS = [
  { id: 'joghurt-klein', cat: /^beilagen$/i, name: 'Joghurt klein', desc: 'hausgemachtes Joghurtdressing', v: [['', 150]] },
  { id: 'joghurt-gross', cat: /^beilagen$/i, name: 'Joghurt groß', desc: 'hausgemachtes Joghurtdressing', v: [['', 250]] },
];

// Tippfehler der Quelle, die beim Import korrigiert werden (Namen und Beschreibungen).
const TEXT_FIXES = [
  ['Ananans', 'Ananas'],
  ['Quattro Staggioni', 'Quattro Stagioni'],
  ['Meditarrene', 'Mediterrane'],
  ['frischer Basilikum', 'frisches Basilikum'],
  ['Grecco', 'Greco'],
  ['knackigerSalat', 'knackiger Salat'],
  ['Burger Sauce(2,d,f) ,', 'Burger Sauce (2,d,f),'],
  ['Chilli', 'Chili'],
  ['Cheesburger', 'Cheeseburger'],
  ['Schmlezkäse', 'Schmelzkäse'],
  ['Mayonaise', 'Mayonnaise'],
  ['Röstzwiebelen', 'Röstzwiebeln'],
  ['Speiegelei', 'Spiegelei'],
  ['Metaxasauce mir Käse', 'Metaxasauce mit Käse'],
  ['Nudel Gerichte', 'Nudelgerichte'],
  ['Süß-sauer Sauce', 'Süß-sauer-Sauce'],
  ['Wasser Stil', 'Wasser still'],
  ['Pizzabrot(a,e)', 'Pizzabrot (a,e)'],
  ['Mezzo-Mix', 'Mezzo Mix'],
  // einheitliche Schreibweise
  ['Jalapenos', 'Jalapeños'],
  ['Tzaziki', 'Zaziki'],
  ['Brokkoli', 'Broccoli'],
];
// Größenbezeichnungen (nur bei exakter Übereinstimmung)
const LABEL_FIXES = [
  ['0,5 ml', '0,5 l'],
  ['28cm', '30cm'], // Extra "Artischocken": gleiche Größen wie alle anderen Pizza-Extras
  ['32cm', '40cm'],
  ['Ohne Knoblauch', 'ohne Knoblauch'],
];

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', euro: '€' };

function clean(s) {
  return s
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m)
    .replace(/ /g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function fixText(s, used) {
  for (const [from, to] of TEXT_FIXES) {
    if (s.includes(from)) {
      s = s.split(from).join(to);
      used.add(from);
    }
  }
  return s;
}

function fixLabel(s, used) {
  const hit = LABEL_FIXES.find(([from]) => from === s);
  if (!hit) return s;
  used.add(hit[0]);
  return hit[1];
}

export function parseMenu(html) {
  const used = new Set();
  let categories = [];
  const excluded = [];
  const byId = new Map();
  for (const m of html.matchAll(/<h[34] class="[^"]*anchor[^"]*" id="(\d+)">(.*?)<\/h[34]>/gs)) {
    const cat = { id: +m[1], name: clean(m[2]), items: [] };
    categories.push(cat);
    byId.set(cat.id, cat);
  }
  const problems = [];
  const rowRe = /<tr class="dish-row" data-dish-id="(\d+)" data-dish-category-id="(\d+)"[^>]*>(.*?)<\/tr>/gs;
  for (const m of html.matchAll(rowRe)) {
    const [, dishId, catId, body] = m;
    const tds = [...body.matchAll(/<td[^>]*>(.*?)<\/td>/gs)].map((t) => t[1]);
    const title = /<div class="dish-title">(.*?)<\/div>/s.exec(tds[0] ?? '');
    const cat = byId.get(+catId);
    if (tds.length !== 2 || !title || !cat) {
      problems.push(`Gericht ${dishId}: unerwarteter Aufbau`);
      continue;
    }
    const nr = clean(title[1].split('<span')[0]).replace(/\.$/, '');
    // Allergen-/Zusatzstoff-Kürzel wie "(2,4,6)" werden nicht übernommen.
    const name = stripAllergens(fixText(clean(/<span class="supMixtures">(.*?)<\/span>/s.exec(title[1])?.[1] ?? title[1]), used));
    const desc = stripAllergens(fixText(clean(tds[0].slice(title.index + title[0].length)), used));
    const variants = [];
    for (const d of tds[1].matchAll(/<div class="[^"]*">(.*?)<\/div>/gs)) {
      const txt = clean(d[1]);
      const p = /^(?:(.*?) - )?(\d+),(\d{2}) €$/.exec(txt);
      if (!p) {
        problems.push(`Gericht ${dishId} (${name}): Preis nicht lesbar: "${txt}"`);
        continue;
      }
      variants.push([fixLabel(p[1] ?? '', used), +p[2] * 100 + +p[3]]);
    }
    if (!variants.length) {
      problems.push(`Gericht ${dishId} (${name}): kein Preis`);
      continue;
    }
    const item = { id: +dishId, nr, name, desc, v: variants };
    // Die Quelle listet manche Gerichte doppelt – identische Einträge nur einmal übernehmen.
    const same = (o) => JSON.stringify([o.nr, o.name, o.desc, o.v]) === JSON.stringify([nr, name, desc, variants]);
    if (cat.items.some(same)) continue;
    if (EXCLUDED_PRODUCTS.includes(name)) {
      excluded.push(name);
      continue;
    }
    cat.items.push(item);
  }
  for (const name of EXCLUDED_PRODUCTS) if (!excluded.includes(name)) problems.push(`Ausgeschlossener Artikel "${name}" nicht gefunden`);
  categories = categories.filter((c) => c.items.length > 0);
  for (const cat of categories) {
    cat.tax = DRINKS.test(cat.name) ? 19 : 7;
    cat.isExtras = EXTRAS_RULES.some((r) => r.extras.test(cat.name));
    cat.station = NO_STATION.test(cat.name) ? 'none' : PIZZA_STATION.test(cat.name) ? 'pizza' : 'kitchen';
    const rule = !cat.isExtras && EXTRAS_RULES.find((r) => r.for.test(cat.name));
    const extras = rule && categories.find((c) => rule.extras.test(c.name));
    cat.extras = extras ? extras.id : null;
  }
  for (const p of LOCAL_PRODUCTS) {
    const cat = categories.find((c) => p.cat.test(c.name));
    if (!cat) problems.push(`Eigener Artikel "${p.name}": Kategorie nicht gefunden`);
    else cat.items.push({ id: p.id, nr: p.nr ?? '', name: p.name, desc: p.desc ?? '', v: p.v });
  }
  for (const cat of categories) {
    for (const item of cat.items) {
      const opts = buildOptions(cat, item);
      if (opts.length) item.opts = opts;
    }
  }
  // Korrekturen, die nichts mehr treffen: Die Quelle wurde inzwischen selbst berichtigt.
  const unused = [...TEXT_FIXES, ...LABEL_FIXES].map(([from]) => from).filter((from) => !used.has(from));
  return { categories, problems, corrected: [...used], unused };
}

// Kurze Prüfsumme über den Inhalt: Daran erkennt die Kasse einen neuen Stand der Speisekarte.
function revision(data) {
  let h = 5381;
  for (const ch of JSON.stringify(data)) h = ((h * 33) ^ ch.codePointAt(0)) >>> 0;
  return h.toString(36);
}

function render({ categories }, fetchedAt) {
  const cats = categories.map(({ items, ...c }) => c);
  const products = categories.flatMap((c) =>
    c.items.map((i) => ({ id: i.id, cat: c.id, nr: i.nr, name: i.name, desc: i.desc, v: i.v, ...(i.opts ? { opts: i.opts } : {}) })),
  );
  const lines = [
    '// Automatisch erzeugt von tools/fetch-menu.mjs – nicht von Hand bearbeiten.',
    `// Quelle: ${SOURCE_URL}`,
    `export const MENU_SOURCE = ${JSON.stringify({ url: SOURCE_URL, fetchedAt, rev: revision([cats, products]) })};`,
    '',
    '// tax: MwSt.-Satz in %, extras: Kategorie mit den passenden Extras, isExtras: reine Extras-Kategorie,',
    '// station: auf welchem Küchenbon die Artikel stehen (pizza | kitchen | none = auf keinem)',
    'export const CATEGORIES = [',
    ...cats.map((c) => `  ${JSON.stringify(c)},`),
    '];',
    '',
    '// v: Varianten als [Bezeichnung, Preis in Cent]; opts: Auswahlgruppen (siehe OPTION_RULES in tools/fetch-menu.mjs)',
    'export const PRODUCTS = [',
    ...products.map((p) => `  ${JSON.stringify(p)},`),
    '];',
    '',
  ];
  return { text: lines.join('\n'), count: products.length };
}

async function main() {
  const file = process.argv[2];
  let html;
  if (file) {
    html = await readFile(file, 'utf8');
  } else {
    const res = await fetch(SOURCE_URL, { headers: { 'user-agent': 'Mozilla/5.0 (menu-import)' } });
    if (!res.ok) throw new Error(`Abruf fehlgeschlagen: HTTP ${res.status}`);
    html = await res.text();
  }
  const menu = parseMenu(html);
  if (!menu.categories.length) throw new Error('Keine Kategorien gefunden – hat sich der Seitenaufbau geändert?');
  const { text, count } = render(menu, new Date().toISOString().slice(0, 10));
  await writeFile(OUT, text);
  console.log(`${menu.categories.length} Kategorien, ${count} Artikel -> ${path.relative(process.cwd(), OUT)}`);
  for (const c of menu.categories) console.log(`  ${String(c.items.length).padStart(3)}  ${c.name}`);
  console.log(`\n${menu.corrected.length} Tippfehler-Korrekturen angewendet.`);
  if (menu.unused.length) console.log(`Nicht mehr nötig (in der Quelle berichtigt?): ${menu.unused.join(', ')}`);
  if (menu.problems.length) {
    console.warn('\nHinweise:');
    for (const p of menu.problems) console.warn('  - ' + p);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
