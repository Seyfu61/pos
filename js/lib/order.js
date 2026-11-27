// Preis- und Steuerberechnung. Alle Beträge sind Brutto in Cent.

import { fold } from './util.js';

export const ORDER_TYPES = {
  delivery: 'Lieferung',
  pickup: 'Abholung',
};

// Küchenbons werden nach Station getrennt gedruckt.
export const STATIONS = {
  pizza: 'Pizza',
  kitchen: 'Küche',
};

export const STATION_SIDES = {
  pizza: 'Pizzaseite',
  kitchen: 'Küchenseite',
  none: 'kein Küchenbon',
};

/**
 * Station einer Kategorie; ohne Angabe entscheidet der Name:
 * Pizza, Calzone, Pizzabrötchen -> Pizzaseite, Getränke -> kein Küchenbon, alles andere -> Küchenseite.
 */
export function categoryStation(cat) {
  if (STATION_SIDES[cat?.station]) return cat.station;
  const name = cat?.name ?? '';
  if (/getränk/i.test(name)) return 'none';
  return /pizza|calzone/i.test(name) ? 'pizza' : 'kitchen';
}

/** Text einer Zusatzangabe an einer Position: "+ Käserand", "mit Twister Pommes", "ohne Zwiebeln". */
export function extraLabel(e) {
  return e.prefix ? `${e.prefix} ${e.name}` : `+ ${e.name}`;
}

/** Vorauswahl der Auswahlgruppen eines Artikels: { Gruppenname: Index | Set von Namen | null } */
export function defaultSelection(opts = []) {
  return Object.fromEntries(opts.map((g) => [g.name, g.type === 'many' ? new Set() : (g.default ?? null)]));
}

/** Auswahl -> Einträge für line.extras ({ name, price, group, prefix }), in der Reihenfolge der Gruppen. */
export function selectionEntries(opts = [], sel = {}) {
  const out = [];
  for (const g of opts) {
    const picked = g.type === 'many' ? g.choices.filter(([n]) => sel[g.name]?.has(n)) : g.choices[sel[g.name]] ? [g.choices[sel[g.name]]] : [];
    for (const [name, price] of picked) out.push({ name, price: price ?? 0, group: g.name, prefix: g.prefix ?? '' });
  }
  return out;
}

/** Gespeicherte Einträge einer Position -> Auswahl (zum Bearbeiten). Unbekannte Namen fallen auf die Vorgabe zurück. */
export function entriesToSelection(opts = [], entries = []) {
  const sel = defaultSelection(opts);
  for (const g of opts) {
    const mine = entries.filter((e) => e.group === g.name);
    if (!mine.length) continue;
    if (g.type === 'many') sel[g.name] = new Set(mine.map((e) => e.name).filter((n) => g.choices.some(([c]) => c === n)));
    else {
      const i = g.choices.findIndex(([c]) => c === mine[0].name);
      if (i >= 0) sel[g.name] = i;
    }
  }
  return sel;
}

/** Pflichtgruppen, in denen noch nichts gewählt ist. */
export function missingSelection(opts = [], sel = {}) {
  return opts.filter((g) => g.required && g.type !== 'many' && sel[g.name] == null).map((g) => g.name);
}

/** Station einer Bon-Position (an der Position gemerkt, sonst über ihre Kategorie). */
export function lineStation(line, categories = []) {
  if (STATION_SIDES[line.station]) return line.station;
  return categoryStation(categories.find((c) => c.id === line.catId));
}

export const PAYMENTS = {
  cash: 'Bar',
  card: 'Karte',
};

/**
 * Preis eines Extras passend zur gewählten Größe des Hauptartikels.
 * Erst über die gleiche Bezeichnung ("40cm"), sonst über die gleiche Position,
 * sonst der erste Preis.
 */
export function extraPrice(extra, product, variantIndex) {
  const ev = extra.v;
  if (ev.length === 1) return ev[0][1];
  const label = product?.v?.[variantIndex]?.[0];
  const byLabel = ev.find(([l]) => l && l === label);
  if (byLabel) return byLabel[1];
  if (product && product.v.length === ev.length && ev[variantIndex]) return ev[variantIndex][1];
  return ev[0][1];
}

export function lineUnitPrice(line) {
  return line.unitPrice + (line.extras ?? []).reduce((s, e) => s + e.price, 0);
}

export function lineTotal(line) {
  return lineUnitPrice(line) * line.qty;
}

/** Zwei Positionen sind zusammenfassbar, wenn Artikel, Größe, Extras und Notiz gleich sind. */
export function sameLine(a, b) {
  const sig = (l) =>
    JSON.stringify([l.productId, l.name, l.variant, l.unitPrice, l.tax, (l.halves ?? []).map((h) => h.productId), (l.extras ?? []).map((e) => [e.name, e.price, e.prefix ?? '']), l.note ?? '']);
  return sig(a) === sig(b);
}

/**
 * Summen einer Bestellung.
 * @returns {{ items:number, deliveryFee:number, total:number, count:number,
 *             taxes:{rate:number, gross:number, net:number, tax:number}[] }}
 */
export function orderTotals(order, { deliveryTax = 7 } = {}) {
  const byRate = new Map();
  const add = (rate, gross) => byRate.set(rate, (byRate.get(rate) ?? 0) + gross);
  let items = 0;
  let count = 0;
  for (const line of order.lines ?? []) {
    const t = lineTotal(line);
    items += t;
    count += line.qty;
    add(line.tax ?? 7, t);
  }
  const deliveryFee = order.type === 'delivery' ? order.deliveryFee ?? 0 : 0;
  if (deliveryFee) add(deliveryTax, deliveryFee);
  const taxes = [...byRate.entries()]
    .filter(([, gross]) => gross !== 0)
    .sort((a, b) => a[0] - b[0])
    .map(([rate, gross]) => {
      const net = Math.round(gross / (1 + rate / 100));
      return { rate, gross, net, tax: gross - net };
    });
  return { items, deliveryFee, total: items + deliveryFee, count, taxes };
}

/** Tagesauswertung über abgeschlossene Bestellungen. */
export function daySummary(orders) {
  const sum = {
    count: 0,
    total: 0,
    cancelledCount: 0,
    cancelledTotal: 0,
    deliveryFees: 0,
    byPayment: {},
    byType: {},
    taxes: [],
    products: [],
  };
  const taxes = new Map();
  const products = new Map();
  for (const o of orders) {
    if (o.status === 'cancelled') {
      sum.cancelledCount++;
      sum.cancelledTotal += o.total;
      continue;
    }
    sum.count++;
    sum.total += o.total;
    sum.deliveryFees += o.deliveryFee ?? 0;
    const pay = (sum.byPayment[o.payment] ??= { count: 0, total: 0 });
    pay.count++;
    pay.total += o.total;
    const type = (sum.byType[o.type] ??= { count: 0, total: 0 });
    type.count++;
    type.total += o.total;
    for (const t of o.taxes ?? []) {
      const e = taxes.get(t.rate) ?? { rate: t.rate, gross: 0, net: 0, tax: 0 };
      e.gross += t.gross;
      e.net += t.net;
      e.tax += t.tax;
      taxes.set(t.rate, e);
    }
    for (const l of o.lines ?? []) {
      const key = `${l.nr}|${l.name}|${l.variant ?? ''}`;
      const e = products.get(key) ?? { nr: l.nr, name: l.name, variant: l.variant, qty: 0, total: 0 };
      e.qty += l.qty;
      e.total += lineTotal(l);
      products.set(key, e);
    }
  }
  sum.taxes = [...taxes.values()].sort((a, b) => a.rate - b.rate);
  sum.products = [...products.values()].sort((a, b) => b.qty - a.qty);
  return sum;
}

// --- Liefergebiete -------------------------------------------------------------------------

const placeKey = (s) => fold(s).replace(/[^a-z0-9]/g, ''); // "Klein Schneen" = "Kleinschneen" = "klein-schneen"

/**
 * Lieferkosten nach Liefergebiet.
 * Ein Ortsname passt, wenn er im Ort des Kunden vorkommt ("Rosdorf-Obernjesa", "Friedland OT Kleinschneen");
 * eine fünfstellige Angabe gilt als PLZ. Passen mehrere, gewinnt der genaueste (längste) Ortsname.
 * @returns {{ fee:number, place:string } | null}
 */
export function zoneFee(customer, zones = []) {
  const city = placeKey(customer?.city);
  const zip = String(customer?.zip ?? '').trim();
  let best = null;
  for (const z of zones) {
    for (const place of z.places ?? []) {
      const p = String(place).trim();
      if (!p) continue;
      const isZip = /^\d{5}$/.test(p);
      const hit = isZip ? p === zip : city && city.includes(placeKey(p));
      if (!hit) continue;
      const score = isZip ? 1 : 100 + placeKey(p).length; // Ortsname vor PLZ, genauer vor ungenauer
      if (!best || score > best.score) best = { fee: z.fee, place: p, score };
    }
  }
  return best && { fee: best.fee, place: best.place };
}

/**
 * Lieferkosten für einen Kunden: zuerst nach Liefergebiet, sonst wie bei seiner letzten Lieferung.
 * @returns {{ fee:number, source:'zone'|'customer'|'none', place?:string }}
 */
export function autoDeliveryFee(customer, zones = []) {
  const z = zoneFee(customer, zones);
  if (z) return { fee: z.fee, source: 'zone', place: z.place };
  if (Number.isInteger(customer?.lastFee)) return { fee: customer.lastFee, source: 'customer' };
  return { fee: 0, source: 'none' };
}

// --- Bearbeitungsstand und Fälligkeit ------------------------------------------------------

/** Ablauf einer Bestellung: Küche -> unterwegs (Lieferung) bzw. abholbereit (Abholung) -> erledigt. */
export const STAGES = {
  kitchen: 'In der Küche',
  out: 'Unterwegs',
  ready: 'Abholbereit',
  done: 'Erledigt',
};

/** Nächster Schritt und Beschriftung des Knopfes dafür. */
export function nextStage(order) {
  if (order.stage === 'kitchen') return order.type === 'pickup' ? { stage: 'ready', label: 'Abholbereit' } : { stage: 'out', label: 'Unterwegs' };
  if (order.stage === 'out') return { stage: 'done', label: 'Geliefert' };
  if (order.stage === 'ready') return { stage: 'done', label: 'Abgeholt' };
  return null;
}

/** Noch nicht erledigt? (Bestellungen aus älteren Versionen haben keinen Stand und gelten als erledigt.) */
export function isOpenOrder(order) {
  return order.status !== 'cancelled' && Boolean(order.stage) && order.stage !== 'done';
}

/** "19:30" -> Zeitpunkt heute um 19:30 (bezogen auf `now`). Ungültig -> null. */
export function timeToday(hhmm, now = new Date()) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm ?? '').trim());
  if (!m || +m[1] > 23 || +m[2] > 59) return null;
  const d = new Date(now);
  d.setHours(+m[1], +m[2], 0, 0);
  return d;
}

/**
 * Wann muss die Bestellung raus? Vorbestellung: gewünschte Uhrzeit. Sonst: Eingang + Zielzeit der Bestellart.
 * @returns {{ due:Date, left:number, elapsed:number, level:'ok'|'soon'|'late'|'pre', preorder:boolean }}
 *   left/elapsed in ganzen Minuten; level: pre = Vorbestellung, die noch über eine Stunde Zeit hat
 */
export function orderDue(order, orderSettings = {}, now = new Date()) {
  const prep = orderSettings.prepMinutes?.[order.type] ?? (order.type === 'pickup' ? 20 : 45);
  const soon = orderSettings.soonMinutes ?? 10;
  const created = new Date(order.createdAt);
  const preorder = Boolean(order.dueAt);
  const due = preorder ? new Date(order.dueAt) : new Date(created.getTime() + prep * 60000);
  const left = Math.floor((due - now) / 60000);
  const elapsed = Math.max(0, Math.floor((now - created) / 60000));
  const level = left < 0 ? 'late' : left <= soon ? 'soon' : preorder && left > 60 ? 'pre' : 'ok';
  return { due, left, elapsed, level, preorder };
}

/** 75 -> "1 Std. 15 Min." */
export function fmtMinutes(min) {
  const m = Math.abs(Math.round(min));
  if (m < 60) return `${m} Min.`;
  return `${Math.floor(m / 60)} Std.${m % 60 ? ` ${m % 60} Min.` : ''}`;
}

// --- Halb/halb ----------------------------------------------------------------------------

/** Lassen sich die Artikel dieser Kategorie halbieren? (Pizza – über das Feld "halves" auch für andere einstellbar) */
export function canHalve(cat) {
  return cat?.halves ?? /^pizza$/i.test(cat?.name ?? '');
}

/** Preis eines Artikels in der Größe mit dieser Bezeichnung ("40cm"), sonst an gleicher Stelle. null = gibt es nicht. */
export function priceForSize(product, label, index = 0) {
  const byLabel = product?.v?.find(([l]) => l === label);
  if (byLabel) return byLabel[1];
  return product?.v?.[index]?.[1] ?? null;
}

/**
 * Preis einer halb/halb-Pizza.
 * 'max': Preis der teureren Hälfte · 'avg': Durchschnitt beider Hälften, auf 10 Cent aufgerundet
 */
export function halfPrice(a, b, mode = 'max') {
  if (mode === 'avg') return Math.ceil((a + b) / 2 / 10) * 10;
  return Math.max(a, b);
}

export const HALF_PRICE_MODES = {
  max: 'teurere Hälfte',
  avg: 'Durchschnitt (auf 10 Cent aufgerundet)',
};
