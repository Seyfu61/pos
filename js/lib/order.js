// Preis- und Steuerberechnung. Alle Beträge sind Brutto in Cent.

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
    JSON.stringify([l.productId, l.name, l.variant, l.unitPrice, l.tax, (l.extras ?? []).map((e) => [e.name, e.price, e.prefix ?? '']), l.note ?? '']);
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
