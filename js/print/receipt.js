// Baut Bons als geräteunabhängige Liste von Blöcken auf.
// raster.js zeichnet daraus das Druckbild (und die Vorschau am Bildschirm).
//
// Blocktypen:
//   { t:'text', text, align, size, bold }      size: s | m | l | xl
//   { t:'row',  left, right, size, bold, indent }
//   { t:'cols', cells:[{ text, w, align }], size, bold }
//   { t:'box',  text, size }                    weiß auf schwarz, zentriert
//   { t:'rule', dashed } / { t:'space', h }

import { eur, fmtDateTime, fmtDayKey } from '../lib/util.js';
import { ORDER_TYPES, PAYMENTS } from '../lib/order.js';

const text = (t, o = {}) => ({ t: 'text', text: t, ...o });
const row = (left, right, o = {}) => ({ t: 'row', left, right, ...o });
const rule = (o = {}) => ({ t: 'rule', ...o });
const space = (h = 10) => ({ t: 'space', h });
const box = (t, o = {}) => ({ t: 'box', text: t, ...o });

export function lineTitle(line) {
  return [line.nr, line.name, line.variant].filter(Boolean).join(' ');
}

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
  b.push(space(4), box(`${ORDER_TYPES[order.type].toUpperCase()}  #${order.dayNr}`, { size: 'l' }), space(6));
  if (customerBlock(b, order, { large: order.type === 'delivery' })) b.push(space(2));
  if (order.note) b.push(text(`» ${order.note}`, { bold: true }));
  b.push(rule());

  for (const l of order.lines) {
    b.push(row(`${l.qty}x ${lineTitle(l)}`, eur(l.unitPrice * l.qty, { symbol: false }), { bold: true }));
    for (const e of l.extras ?? []) b.push(row(`+ ${e.name}`, eur(e.price * l.qty, { symbol: false }), { indent: 28 }));
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
  if (order.payment === 'cash' && order.given > order.total) {
    b.push(row('Gegeben', eur(order.given, { symbol: false })));
    b.push(row('Rückgeld', eur(order.given - order.total, { symbol: false })));
  }
  b.push(space(10));
  taxTable(b, order.taxes);
  if (settings.shop.footer) {
    b.push(space(14));
    for (const l of settings.shop.footer.split('\n')) b.push(text(l, { align: 'center' }));
  }
  b.push(space(8));
  return b;
}

/** Küchenbon: große Schrift, keine Preise */
export function kitchenTicket(order) {
  const b = [];
  b.push(box(`#${order.dayNr}  ${ORDER_TYPES[order.type].toUpperCase()}`, { size: 'xl' }));
  b.push(space(6), row(fmtDateTime(order.createdAt), `Bon-Nr. ${order.bonNr}`, { size: 's' }));
  const c = order.customer;
  if (c?.name) b.push(text([c.name, order.type === 'delivery' ? c.city : ''].filter(Boolean).join(' · '), { bold: true }));
  if (order.note) b.push(text(`» ${order.note}`, { bold: true, size: 'l' }));
  b.push(rule());
  order.lines.forEach((l, i) => {
    if (i) b.push(rule({ dashed: true }));
    b.push(text(`${l.qty}x ${lineTitle(l)}`, { bold: true, size: 'l' }));
    for (const e of l.extras ?? []) b.push(text(`+ ${e.name}`, { size: 'l', indent: 28 }));
    if (l.note) b.push(text(`» ${l.note}`, { size: 'l', bold: true, indent: 28 }));
  });
  b.push(rule());
  const n = order.lines.reduce((s, l) => s + l.qty, 0);
  b.push(text(`${n} Artikel`, { align: 'center' }), space(8));
  return b;
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
