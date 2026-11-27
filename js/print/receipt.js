// Baut Bons als geräteunabhängige Liste von Blöcken auf.
// raster.js zeichnet daraus das Druckbild (und die Vorschau am Bildschirm).
//
// Blocktypen:
//   { t:'text', text, align, size, bold }      size: s | m | l | xl
//   { t:'row',  left, right, size, bold, indent }
//   { t:'cols', cells:[{ text, w, align }], size, bold }
//   { t:'box',  text, size }                    weiß auf schwarz, zentriert
//   { t:'qr',   data, caption }                QR-Code, zentriert
//   { t:'rule', dashed } / { t:'space', h }

import { eur, fmtDateTime, fmtDayKey, fmtTime } from '../lib/util.js';
import { ORDER_TYPES, PAYMENTS, STATIONS, extraLabel, lineStation } from '../lib/order.js';

const text = (t, o = {}) => ({ t: 'text', text: t, ...o });
const row = (left, right, o = {}) => ({ t: 'row', left, right, ...o });
const rule = (o = {}) => ({ t: 'rule', ...o });
const space = (h = 10) => ({ t: 'space', h });
const box = (t, o = {}) => ({ t: 'box', text: t, ...o });

const typeLabel = (order) => (ORDER_TYPES[order.type] ?? String(order.type ?? '')).toUpperCase();

/** Google-Maps-Link, der die Route zur Lieferadresse öffnet (für den QR-Code auf dem Bon). */
export function mapsUrl(customer) {
  const address = [customer?.street, [customer?.zip, customer?.city].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  if (!customer?.street || !address) return '';
  return `https://www.google.com/maps/dir/?${new URLSearchParams({ api: '1', destination: address })}`;
}

const halfTitle = (h) => `½ ${[h.nr, h.name].filter(Boolean).join(' ')}`;

/** Einzeilige Bezeichnung einer Position, bei halb/halb: "½ 223 Pizza Salami + ½ 222 Pizza Funghi 40cm". */
export function lineTitle(line) {
  if (line.halves?.length) return [line.halves.map(halfTitle).join(' + '), line.variant].filter(Boolean).join(' ');
  return [line.nr, line.name, line.variant].filter(Boolean).join(' ');
}

/** Die beiden Hälften als eigene Zeilen (für Küchen- und Kundenbon). */
export const halfLines = (line) => (line.halves ?? []).map(halfTitle);

function header(b, shop) {
  if (shop.name) b.push(text(shop.name, { align: 'center', size: 'xl', bold: true }));
  for (const l of [shop.line1, shop.line2, shop.phone && `Tel. ${shop.phone}`, shop.taxId]) {
    if (l) b.push(text(l, { align: 'center', size: l === shop.taxId ? 's' : 'm' }));
  }
}

function customerBlock(b, order, { large = false } = {}) {
  const c = order.customer;
  if (!c) return false;
  if (c.name) b.push(text(c.name, { bold: true, size: large ? 'l' : 'm' }));
  if (order.type === 'delivery' || large) {
    if (c.street) b.push(text(c.street, { bold: order.type === 'delivery', size: large ? 'l' : 'm' }));
    const city = [c.zip, c.city].filter(Boolean).join(' ');
    if (city) b.push(text(city));
  }
  if (c.phone) b.push(text(`Tel. ${c.phone}`));
  if (c.note) b.push(text(`Hinweis: ${c.note}`));
  return true;
}

function taxTable(b, taxes) {
  const cols = (cells, o = {}) => ({
    t: 'cols',
    size: 's',
    cells: cells.map((c, i) => ({ text: c, w: [0.19, 0.27, 0.27, 0.27][i], align: i ? 'right' : 'left' })),
    ...o,
  });
  b.push(cols(['MwSt.', 'Netto', 'Steuer', 'Brutto'], { bold: true }));
  for (const t of taxes) {
    b.push(cols([`${String(t.rate).replace('.', ',')} %`, eur(t.net, { symbol: false }), eur(t.tax, { symbol: false }), eur(t.gross, { symbol: false })]));
  }
}

/** Kundenbon / Rechnung */
export function customerReceipt(order, settings) {
  const b = [];
  header(b, settings.shop);
  b.push(space(6), rule());
  if (order.status === 'cancelled') b.push(box('STORNIERT', { size: 'l' }), space(4));
  b.push(row(`Bon-Nr. ${order.bonNr}`, fmtDateTime(order.createdAt), { size: 's' }));
  b.push(space(4), box(`${typeLabel(order)}  #${order.dayNr}`, { size: 'l' }), space(6));
  if (order.dueAt) b.push(text(`${order.type === 'pickup' ? 'Abholung' : 'Lieferung'} um ${fmtTime(order.dueAt)} Uhr`, { bold: true, size: 'l' }));
  if (customerBlock(b, order, { large: order.type === 'delivery' })) b.push(space(2));
  const maps = order.type === 'delivery' && settings.printer?.mapsQr !== false ? mapsUrl(order.customer) : '';
  if (maps) b.push({ t: 'qr', data: maps, caption: 'Route in Google Maps: QR-Code scannen' });
  if (order.note) b.push(text(`» ${order.note}`, { bold: true }));
  b.push(rule());

  for (const l of order.lines) {
    const head = l.halves?.length ? [l.name, l.variant].filter(Boolean).join(' ') : lineTitle(l);
    b.push(row(`${l.qty}x ${head}`, eur(l.unitPrice * l.qty, { symbol: false }), { bold: true }));
    for (const h of halfLines(l)) b.push(text(h, { indent: 28 }));
    for (const e of l.extras ?? []) b.push(row(extraLabel(e), e.price ? eur(e.price * l.qty, { symbol: false }) : '', { indent: 28 }));
    if (l.note) b.push(text(`» ${l.note}`, { indent: 28 }));
  }
  b.push(rule());

  if (order.deliveryFee) {
    b.push(row('Zwischensumme', eur(order.itemsTotal, { symbol: false })));
    b.push(row('Lieferkosten', eur(order.deliveryFee, { symbol: false })));
  }
  b.push(row('SUMME', eur(order.total), { size: 'l', bold: true }));
  b.push(space(4));
  b.push(row('Zahlung', PAYMENTS[order.payment] ?? order.payment ?? '-'));
  b.push(space(10));
  taxTable(b, order.taxes);
  if (settings.shop.footer) {
    b.push(space(14));
    for (const l of settings.shop.footer.split('\n')) b.push(text(l, { align: 'center' }));
  }
  b.push(space(8));
  return b;
}

/**
 * Küchenbons: je ein Bon für Pizzaseite und Küchenseite (große Schrift, keine Preise).
 * Unter den eigenen Artikeln steht klein, was die andere Seite für dieselbe Bestellung macht,
 * damit beide Seiten sich abstimmen können. Stationen ohne Artikel bekommen keinen Bon.
 */
// Schriftgrößen der Küchenbons je Stufe (Rollen -> Größen aus raster.js)
export const KITCHEN_SIZES = {
  normal: { head: 'xl', type: 'l', meta: 's', who: 'm', note: 'l', pre: 'l', item: 'l', sub: 'l', count: 'm', other: 's' },
  large: { head: 'xxl', type: 'xl', meta: 'm', who: 'l', note: 'xl', pre: 'xl', item: 'lx', sub: 'lx', count: 'l', other: 'm' },
  xlarge: { head: 'xxxl', type: 'xl', meta: 'm', who: 'l', note: 'xxl', pre: 'xxl', item: 'xxl', sub: 'xl', count: 'l', other: 'm' },
};
export const KITCHEN_SIZE_LABELS = { normal: 'Normal', large: 'Groß', xlarge: 'Sehr groß' };

export function kitchenTickets(order, categories = [], { size = 'large' } = {}) {
  const z = KITCHEN_SIZES[size] ?? KITCHEN_SIZES.large;
  const groups = Object.fromEntries(Object.keys(STATIONS).map((s) => [s, []]));
  // Positionen ohne Station (z. B. Getränke) erscheinen auf keinem Küchenbon.
  for (const l of order.lines) groups[lineStation(l, categories)]?.push(l);
  const count = (lines) => lines.reduce((n, l) => n + l.qty, 0);
  const tickets = [];
  for (const station of Object.keys(STATIONS)) {
    const lines = groups[station];
    if (!lines.length) continue;
    const b = [];
    b.push(box(`${STATIONS[station].toUpperCase()}  #${order.dayNr}`, { size: z.head }));
    b.push(space(4), text(typeLabel(order), { align: 'center', size: z.type, bold: true }));
    b.push(row(fmtDateTime(order.createdAt), `Bon-Nr. ${order.bonNr}`, { size: z.meta }));
    if (order.dueAt) b.push(space(4), box(`VORBESTELLT: ${fmtTime(order.dueAt)} UHR`, { size: z.pre }), space(4));
    const c = order.customer;
    if (c?.name) b.push(text([c.name, order.type === 'delivery' ? c.city : ''].filter(Boolean).join(' · '), { bold: true, size: z.who }));
    if (order.note) b.push(text(`» ${order.note}`, { bold: true, size: z.note }));
    b.push(rule());
    lines.forEach((l, i) => {
      if (i) b.push(rule({ dashed: true }));
      if (l.halves?.length) {
        b.push(text(`${l.qty}x HALB/HALB ${l.variant ?? ''}`.trim(), { bold: true, size: z.item }));
        for (const h of halfLines(l)) b.push(text(h, { bold: true, size: z.sub, indent: 28 }));
      } else b.push(text(`${l.qty}x ${lineTitle(l)}`, { bold: true, size: z.item }));
      for (const e of l.extras ?? []) b.push(text(extraLabel(e), { size: z.sub, indent: 28, bold: e.prefix === 'ohne' }));
      if (l.note) b.push(text(`» ${l.note}`, { size: z.sub, bold: true, indent: 28 }));
    });
    b.push(rule());
    b.push(text(`${count(lines)} Artikel`, { align: 'center', size: z.count }));
    for (const other of Object.keys(STATIONS).filter((s) => s !== station)) {
      if (groups[other].length) {
        b.push(rule({ dashed: true }), text(`Außerdem bei ${STATIONS[other].toUpperCase()}:`, { bold: true, size: z.other }));
        for (const l of groups[other]) b.push(text(`${l.qty}x ${lineTitle(l)}`, { size: z.other }));
      } else {
        b.push(text(`Nichts bei ${STATIONS[other]}.`, { align: 'center', size: z.other }));
      }
    }
    b.push(space(8));
    tickets.push(b);
  }
  return tickets;
}

/** Beispielbestellung für die Vorschau in den Einstellungen. */
export function sampleOrder() {
  return {
    bonNr: 42, dayNr: 7, createdAt: new Date().toISOString(), type: 'delivery', status: 'done',
    customer: { name: 'Max Mustermann', street: 'Musterweg 1', zip: '37124', city: 'Obernjesa' },
    note: 'klingeln bei Hinterhaus',
    lines: [
      { nr: '220', name: 'Pizza Margherita', variant: '40cm', qty: 2, station: 'pizza', extras: [{ name: 'Käserand', price: 250 }], note: 'gut durch' },
      { nr: '', name: 'Pizza halb/halb', variant: '30cm', qty: 1, station: 'pizza', extras: [],
        halves: [{ nr: '223', name: 'Pizza Salami' }, { nr: '222', name: 'Pizza Funghi' }] },
      { nr: '101', name: 'Cheesehamburger', variant: '', qty: 1, station: 'kitchen', note: '',
        extras: [{ name: 'Pommes', price: 0, group: 'Pommes', prefix: 'mit' }, { name: 'Zwiebeln', price: 0, group: 'Ohne', prefix: 'ohne' }] },
    ],
  };
}

/** Tagesbericht */
export function dayReport(day, sum, settings) {
  const b = [];
  if (settings.shop.name) b.push(text(settings.shop.name, { align: 'center', size: 'l', bold: true }));
  b.push(box(`TAGESBERICHT ${fmtDayKey(day)}`, { size: 'l' }), space(4));
  b.push(text(`Gedruckt: ${fmtDateTime(new Date())}`, { align: 'center', size: 's' }), rule());
  b.push(row('Bestellungen', String(sum.count)));
  b.push(row('UMSATZ', eur(sum.total), { size: 'l', bold: true }));
  if (sum.deliveryFees) b.push(row('davon Lieferkosten', eur(sum.deliveryFees, { symbol: false })));
  b.push(rule({ dashed: true }), text('Zahlungsarten', { bold: true }));
  for (const [k, v] of Object.entries(sum.byPayment)) b.push(row(`${PAYMENTS[k] ?? k} (${v.count})`, eur(v.total, { symbol: false })));
  b.push(rule({ dashed: true }), text('Bestellarten', { bold: true }));
  for (const [k, v] of Object.entries(sum.byType)) b.push(row(`${ORDER_TYPES[k] ?? k} (${v.count})`, eur(v.total, { symbol: false })));
  b.push(rule({ dashed: true }));
  taxTable(b, sum.taxes);
  if (sum.cancelledCount) {
    b.push(rule({ dashed: true }), row(`Storniert (${sum.cancelledCount})`, eur(sum.cancelledTotal, { symbol: false })));
  }
  if (sum.products.length) {
    b.push(rule(), text('Verkaufte Artikel', { bold: true }));
    for (const p of sum.products) {
      b.push(row(`${p.qty}x ${[p.nr, p.name, p.variant].filter(Boolean).join(' ')}`, eur(p.total, { symbol: false }), { size: 's' }));
    }
  }
  b.push(space(8));
  return b;
}

/** Testseite zum Prüfen von Verbindung, Breite und Umlauten */
export function testPage(settings, widthDots) {
  const b = [];
  header(b, settings.shop);
  b.push(space(6), box('TESTDRUCK', { size: 'l' }), space(6));
  b.push(text(fmtDateTime(new Date()), { align: 'center' }));
  b.push(rule());
  b.push(row('1x 220 Pizza Margherita 30cm', '9,50', { bold: true }));
  b.push(row('+ Käserand', '2,50', { indent: 28 }));
  b.push(text('» ohne Zwiebeln', { indent: 28 }));
  b.push(rule({ dashed: true }));
  b.push(row('SUMME', '12,00 €', { size: 'l', bold: true }));
  b.push(space(8), text('Umlaute: ÄÖÜ äöü ß · Euro: €', { align: 'center' }));
  b.push(text(`Druckbreite ${widthDots} Punkte`, { align: 'center', size: 's' }));
  b.push(row('|<- links', 'rechts ->|', { size: 's' }));
  b.push(space(8));
  return b;
}
