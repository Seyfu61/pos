// Preis- und Steuerberechnung. Alle Beträge sind Brutto in Cent.

export const ORDER_TYPES = {
  delivery: 'Lieferung',
  pickup: 'Abholung',
};

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
    JSON.stringify([l.productId, l.name, l.variant, l.unitPrice, l.tax, (l.extras ?? []).map((e) => [e.name, e.price]), l.note ?? '']);
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
