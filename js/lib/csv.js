// CSV lesen/schreiben und Kundendaten aus beliebigen Spalten zuordnen.

import { fold, normPhone } from './util.js';

/** Bytes -> Text. Versucht UTF-8, fällt auf Windows-1252 zurück (typisch für Excel-Exporte). */
export function decodeText(buffer) {
  const bytes = new Uint8Array(buffer);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

export function detectDelimiter(text) {
  const head = text.split(/\r?\n/).slice(0, 5).join('\n');
  let best = ';';
  let max = 0;
  for (const d of [';', ',', '\t', '|']) {
    const n = head.split(d).length - 1;
    if (n > max) {
      max = n;
      best = d;
    }
  }
  return best;
}

/** CSV-Text -> Zeilen (Arrays). Unterstützt Anführungszeichen, "" und Zeilenumbrüche in Feldern. */
export function parseCsv(text, delimiter = detectDelimiter(text)) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"' && field === '') {
      quoted = true;
    } else if (c === delimiter) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f.trim() !== ''));
}

export function toCsv(rows, delimiter = ';') {
  const esc = (v) => {
    const s = String(v ?? '');
    return /["\r\n]/.test(s) || s.includes(delimiter) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + rows.map((r) => r.map(esc).join(delimiter)).join('\r\n') + '\r\n';
}

/** Felder, auf die eine Spalte der Importdatei gelegt werden kann. */
export const CUSTOMER_FIELDS = [
  { key: 'nr', label: 'Kundennummer', names: ['kundennummer', 'kundennr', 'kunden-nr', 'kunden nr', 'kdnr', 'kd-nr', 'kd.nr', 'kdnr.', 'nr', 'nr.', 'nummer', 'id', 'kundenid', 'kunden-id'] },
  { key: 'name', label: 'Name (komplett)', names: ['name', 'kunde', 'kundenname', 'vollername', 'anzeigename'] },
  { key: 'firstName', label: 'Vorname', names: ['vorname', 'firstname', 'first name'] },
  { key: 'lastName', label: 'Nachname', names: ['nachname', 'familienname', 'zuname', 'lastname', 'last name', 'surname'] },
  { key: 'company', label: 'Firma', names: ['firma', 'firmenname', 'company', 'unternehmen'] },
  { key: 'phone', label: 'Telefon', names: ['telefon', 'tel', 'tel.', 'telefonnummer', 'telefon1', 'telefon 1', 'phone', 'rufnummer', 'festnetz', 'telnr', 'tel-nr', 'tel.nr.'] },
  { key: 'phone2', label: 'Telefon 2 / Mobil', names: ['telefon2', 'telefon 2', 'mobil', 'handy', 'mobile', 'mobiltelefon', 'mobilnummer', 'handynummer', 'tel2'] },
  { key: 'street', label: 'Straße', names: ['strasse', 'str', 'str.', 'adresse', 'anschrift', 'street', 'address', 'strasse und hausnummer', 'strasse hausnummer', 'strassehausnr'] },
  { key: 'houseNo', label: 'Hausnummer', names: ['hausnummer', 'hausnr', 'hausnr.', 'hnr', 'hnr.', 'haus-nr', 'haus-nr.', 'nr haus'] },
  { key: 'zip', label: 'PLZ', names: ['plz', 'postleitzahl', 'zip', 'postcode'] },
  { key: 'city', label: 'Ort', names: ['ort', 'stadt', 'wohnort', 'city', 'ortsteil', 'ortschaft'] },
  { key: 'note', label: 'Notiz', names: ['notiz', 'notizen', 'bemerkung', 'bemerkungen', 'hinweis', 'hinweise', 'info', 'kommentar', 'anmerkung', 'zusatz', 'note', 'notes'] },
];

/** Zuordnung Spaltenindex -> Feld anhand der Kopfzeile raten. Ergebnis: { feld: spaltenindex } */
export function guessMapping(header) {
  const norm = header.map((h) => fold(h).replace(/[_:]/g, ' ').replace(/\s+/g, ' ').trim());
  const map = {};
  const used = new Set();
  for (const f of CUSTOMER_FIELDS) {
    const idx = norm.findIndex((h, i) => !used.has(i) && f.names.includes(h));
    if (idx >= 0) {
      map[f.key] = idx;
      used.add(idx);
    }
  }
  return map;
}

/** Sieht die erste Zeile wie eine Kopfzeile aus? (keine Telefonnummern/PLZ darin) */
export function looksLikeHeader(row) {
  return row.length > 0 && !row.some((f) => /\d{4,}/.test(f)) && row.some((f) => /[a-zäöü]{2,}/i.test(f));
}

/** Zeilen + Zuordnung -> Kundendatensätze (leere Zeilen werden übersprungen). */
export function rowsToCustomers(rows, mapping) {
  const get = (row, key) => (mapping[key] == null || mapping[key] === '' ? '' : String(row[mapping[key]] ?? '').trim());
  const out = [];
  for (const row of rows) {
    const first = get(row, 'firstName');
    const last = get(row, 'lastName');
    let name = get(row, 'name');
    if (!name) name = [first, last].filter(Boolean).join(' ');
    // "Name" + "Vorname" ohne eigene Nachname-Spalte: "Name" ist dann der Nachname.
    else if (first && !last && !fold(name).includes(fold(first))) name = `${first} ${name}`;
    const company = get(row, 'company');
    const c = {
      nr: get(row, 'nr'),
      name: name || company,
      phone: get(row, 'phone'),
      phone2: get(row, 'phone2'),
      street: [get(row, 'street'), get(row, 'houseNo')].filter(Boolean).join(' '),
      zip: get(row, 'zip'),
      city: get(row, 'city'),
      note: [name && company ? company : '', get(row, 'note')].filter(Boolean).join(' · '),
    };
    if (!c.phone && c.phone2) {
      c.phone = c.phone2;
      c.phone2 = '';
    }
    if (c.name || c.phone || c.street) out.push(c);
  }
  return out;
}

export function customersToRows(customers) {
  const head = ['Kundennummer', 'Name', 'Telefon', 'Telefon 2', 'Straße', 'PLZ', 'Ort', 'Notiz'];
  return [head, ...customers.map((c) => [c.nr, c.name, c.phone, c.phone2, c.street, c.zip, c.city, c.note])];
}

/** Suchindex-Text und normalisierte Nummern einmal je Kunde vorbereiten. */
export function indexCustomer(c) {
  c._phones = [normPhone(c.phone), normPhone(c.phone2)].filter(Boolean);
  c._nr = fold(c.nr);
  c._name = fold(c.name);
  c._addr = fold([c.street, c.zip, c.city].filter(Boolean).join(' '));
  c._text = [c._name, c._addr, c._nr].filter(Boolean).join(' ');
  return c;
}

/** Felder, auf die sich die Kundensuche beschränken lässt. */
export const SEARCH_FIELDS = {
  all: { label: 'Alle', placeholder: 'Telefonnummer, Name oder Straße' },
  nr: { label: 'Nr.', placeholder: 'Kundennummer' },
  name: { label: 'Name', placeholder: 'Name' },
  address: { label: 'Adresse', placeholder: 'Straße, PLZ oder Ort' },
  phone: { label: 'Telefon', placeholder: 'Telefonnummer' },
};

/** Trefferwert für eine Telefonnummer (-1 = kein Treffer). */
function phoneScore(c, digits) {
  let score = -1;
  const bare = digits.replace(/^0+/, '');
  for (const p of c._phones) {
    if (p === digits) score = Math.max(score, 3);
    else if (p.endsWith(digits) || p.startsWith(digits)) score = Math.max(score, 2);
    else if (bare.length >= 3 && p.includes(bare)) score = Math.max(score, 1);
  }
  return score;
}

/** Trefferwert für eine Kundennummer: exakt vor "beginnt mit" (-1 = kein Treffer). */
function nrScore(c, q) {
  if (!c._nr) return -1;
  if (c._nr === q) return 3;
  return c._nr.startsWith(q) ? 2 : -1;
}

/**
 * Kundensuche.
 * field 'all': Ziffern suchen in Telefon- und Kundennummer, Text in Name, Adresse und Nummer.
 * Sonst nur im gewählten Feld: 'nr' | 'name' | 'address' | 'phone'.
 * Die Reihenfolge der Eingabeliste bleibt bei gleich guten Treffern erhalten.
 */
export function searchCustomers(customers, query, limit = 50, field = 'all') {
  const q = query.trim();
  if (!q) return customers.slice(0, limit);
  const fq = fold(q);
  const words = fq.split(/\s+/).filter(Boolean);
  const digits = /^[\d\s+\-/()]+$/.test(q) ? normPhone(q) : '';
  const hasWords = (text) => words.every((w) => text.includes(w));
  const hits = [];
  customers.forEach((c, i) => {
    let score = -1;
    if (field === 'nr') score = nrScore(c, fq);
    else if (field === 'name') score = hasWords(c._name) ? 0 : -1;
    else if (field === 'address') score = hasWords(c._addr) ? 0 : -1;
    else if (field === 'phone') score = digits ? phoneScore(c, digits) : -1;
    else {
      if (digits) score = Math.max(phoneScore(c, digits), nrScore(c, fq) === 3 ? 3 : -1);
      if (score < 0 && hasWords(c._text)) score = 0;
    }
    if (score >= 0) hits.push([score, i, c]);
  });
  hits.sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  return hits.slice(0, limit).map((h) => h[2]);
}
