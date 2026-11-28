// Kleine Hilfsfunktionen ohne Abhängigkeiten (laufen auch unter Node für die Tests).

/** Cent -> "1.234,50 €" */
export function eur(cents, { symbol = true } = {}) {
  const neg = cents < 0;
  const abs = Math.abs(Math.round(cents));
  const euros = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const s = `${neg ? '-' : ''}${euros},${String(abs % 100).padStart(2, '0')}`;
  return symbol ? `${s} €` : s;
}

/** "12,50" | "12.5" | "1.234,50 €" -> Cent (oder null, wenn nicht lesbar) */
export function parseEur(input) {
  if (typeof input === 'number') return Number.isFinite(input) ? Math.round(input * 100) : null;
  let s = String(input ?? '').replace(/[€\s]/g, '');
  if (!s) return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  if (!/^-?\d*\.?\d*$/.test(s) || !/\d/.test(s)) return null;
  return Math.round(parseFloat(s) * 100);
}

const pad = (n) => String(n).padStart(2, '0');

/** Lokaler Tag als "YYYY-MM-DD" */
export function dayKey(d = new Date()) {
  d = new Date(d);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function fmtDate(d) {
  d = new Date(d);
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
}

export function fmtTime(d) {
  d = new Date(d);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export const fmtDateTime = (d) => `${fmtDate(d)} ${fmtTime(d)}`;

/** "2026-11-16" -> "16.11.2026" */
export const fmtDayKey = (key) => key.split('-').reverse().join('.');

/** Telefonnummer auf Ziffern mit führender 0 reduzieren ("+49 551 123" -> "0551123"). */
export function normPhone(p) {
  let s = String(p ?? '').trim();
  if (!s) return '';
  const plus = s.startsWith('+');
  s = s.replace(/\D/g, '');
  if (plus && s.startsWith('49')) s = '0' + s.slice(2);
  else if (s.startsWith('0049')) s = '0' + s.slice(4);
  return s;
}

/** Text für die Suche vereinheitlichen (klein, ohne Umlaute/Akzente). */
export function fold(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function clone(o) {
  return JSON.parse(JSON.stringify(o));
}

/** Sortierung nach Artikelnummer: 99 < 100 < 221 < 221a < 222, ohne Nummer ans Ende. */
export function compareNr(a, b) {
  const pa = /^(\d+)(.*)$/.exec(a ?? '');
  const pb = /^(\d+)(.*)$/.exec(b ?? '');
  if (pa && pb) return +pa[1] - +pb[1] || pa[2].localeCompare(pb[2]);
  if (pa) return -1;
  if (pb) return 1;
  return String(a ?? '').localeCompare(String(b ?? ''));
}

/**
 * Allergen- und Zusatzstoff-Kürzel entfernen: "Käse (2,4,6)" -> "Käse", "Calzone (a,c) Salami" -> "Calzone Salami".
 * Nur Klammern mit kurzen Kürzeln (1–2 Zeichen, mit Komma getrennt); "(100%)", "(scharf)", "(Pizza)" bleiben.
 */
export function stripAllergens(text) {
  return String(text ?? '')
    .replace(/\s*\((?:[0-9a-z]{1,2})(?:\s*,\s*[0-9a-z]{1,2})*\)/gi, '')
    .replace(/\s+([,.])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
