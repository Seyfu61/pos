// Zentraler App-Zustand + alle Aktionen, die Daten verändern.

import * as db from './db.js';
import { clone, dayKey, normPhone, stripAllergens, uid } from './util.js';
import { indexCustomer } from './csv.js';
import { ORDER_TYPES, autoDeliveryFee, categoryStation, halfPrice, priceForSize, isOpenOrder, orderTotals, sameLine, timeToday } from './order.js';
import { DEFAULT_SETTINGS, mergeSettings } from '../data/defaults.js';
import { CATEGORIES, MENU_SOURCE, PRODUCTS } from '../data/menu.js';

export const state = {
  ready: false,
  error: null,
  view: 'pos',
  settings: clone(DEFAULT_SETTINGS),
  menu: { categories: [], products: [] },
  customers: [],
  cart: null,
  toasts: [],
  updateReady: false, // neue Version der Kasse geladen, Neustart nötig
  persisted: false,
  openOrders: [], // noch nicht erledigte Bestellungen (Bereich "Offen")
};

const listeners = new Set();
let version = 0;
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
/** Zähler aller Änderungen – damit merken Komponenten, wenn sie eine Änderung verpasst haben. */
export const getVersion = () => version;
function emit() {
  version++;
  for (const fn of listeners) fn();
}

// --- Meldungen ---------------------------------------------------------------

export function toast(message, kind = 'info', ms = kind === 'error' ? 9000 : 3500) {
  const t = { id: uid(), message, kind };
  state.toasts = [...state.toasts, t];
  emit();
  setTimeout(() => dismissToast(t.id), ms);
}
export function dismissToast(id) {
  state.toasts = state.toasts.filter((t) => t.id !== id);
  emit();
}

export function markUpdateReady() {
  state.updateReady = true;
  emit();
}

export function setView(view) {
  state.view = view;
  emit();
}

// --- Start ---------------------------------------------------------------------

// 2: Auswahl bei Burgern/Gyros/Nuggets, Joghurt groß, Getränke ohne Küchenbon · 3: Dressing-Auswahl bei Salaten
// 4: Joghurt klein · 5: Joghurtdressing unter "Pizzabrötchen Extra" entfernt
// 6: Allergen-Kürzel entfernt, Pizzabrötchen mit den Pizza-Extras
// 7: Saucen (BBQ, Süß-sauer, Ketchup, Mayo) unter Beilagen, Knoblauch bei den Pizza-Extras
export const MENU_SCHEMA = 7;

// Artikel von bringstar, die ab einer Stufe entfernt wurden (ID -> Stufe).
const REMOVED_SINCE = { 12450: 5 };

// Eigene Artikel der Kasse (nicht von bringstar) und ab welcher Stufe es sie gibt.
const LOCAL_SINCE = { 'joghurt-gross': 2, 'joghurt-klein': 4, 'sauce-bbq': 7, 'sauce-suesssauer': 7, ketchup: 7, mayo: 7, knoblauch: 7 };

/** Artikel an der Stelle einfügen, an der er in der mitgelieferten Speisekarte steht (vor seinem Nachfolger). */
function insertLikeSeed(products, product, seedProducts) {
  const at = seedProducts.findIndex((p) => p.id === product.id);
  const next = seedProducts.slice(at + 1).find((p) => p.cat === product.cat && products.some((x) => x.id === p.id));
  const i = next ? products.findIndex((x) => x.id === next.id) : products.findLastIndex((x) => x.cat === product.cat) + 1;
  if (i <= 0 && !next) products.push(product);
  else products.splice(i, 0, product);
}

export function seedMenu() {
  return { schema: MENU_SCHEMA, source: MENU_SOURCE, categories: clone(CATEGORIES), products: clone(PRODUCTS).map((p) => ({ ...p, active: true })) };
}

/**
 * Eine von Hand geänderte Speisekarte an neue Funktionen anpassen, ohne eigene Änderungen zu verlieren:
 * Auswahlmöglichkeiten (Pommes, Zutaten, Sauce) ergänzen, neue eigene Artikel aufnehmen, Getränke vom Küchenbon nehmen.
 */
export function migrateMenu(menu, seed = seedMenu()) {
  const from = menu.schema ?? 1;
  if (from >= MENU_SCHEMA) return menu;
  const seedById = new Map(seed.products.map((p) => [p.id, p]));
  // Auswahlgruppen nur bei Artikeln ergänzen, die noch keine haben – nichts Vorhandenes wird überschrieben.
  const products = menu.products.map((p) => (p.opts || !seedById.get(p.id)?.opts ? p : { ...p, opts: clone(seedById.get(p.id).opts) }));
  let categories = menu.categories;
  // Neue eigene Artikel kommen dazu, sofern ihre Kategorie noch existiert. Was es schon in einer früheren Stufe gab
  // und jetzt fehlt, wurde bewusst gelöscht und kommt nicht zurück.
  const known = new Set(menu.products.map((p) => p.id));
  const cats = new Set(menu.categories.map((c) => c.id));
  for (const p of seed.products) {
    if (typeof p.id === 'string' && !known.has(p.id) && cats.has(p.cat) && (LOCAL_SINCE[p.id] ?? 2) > from) insertLikeSeed(products, clone(p), seed.products);
  }
  // Entfernte Artikel herausnehmen; reine Extras-Kategorien, die dadurch leer werden, entfallen mit.
  const removed = products.filter((p) => (REMOVED_SINCE[p.id] ?? 0) > from);
  if (removed.length) {
    for (const p of removed) products.splice(products.indexOf(p), 1);
    const emptied = new Set(
      removed.map((p) => p.cat).filter((id) => !products.some((p) => p.cat === id) && categories.find((c) => c.id === id)?.isExtras),
    );
    categories = categories.filter((c) => !emptied.has(c.id)).map((c) => (emptied.has(c.extras) ? { ...c, extras: null } : c));
  }
  if (from < 6) {
    // Allergen-/Zusatzstoff-Kürzel aus Namen, Beschreibungen und Auswahl entfernen
    for (let i = 0; i < products.length; i++) {
      const p = products[i];
      products[i] = {
        ...p,
        name: stripAllergens(p.name),
        desc: stripAllergens(p.desc),
        ...(p.opts ? { opts: p.opts.map((g) => ({ ...g, choices: g.choices.map(([n, c]) => [stripAllergens(n), c]) })) } : {}),
      };
    }
    // Pizzabrötchen bekommen die Extras der Pizza (falls noch keine eigenen eingestellt sind)
    const pizzaExtras = categories.find((c) => /^pizza$/i.test(c.name))?.extras;
    if (pizzaExtras != null) categories = categories.map((c) => (/^pizzabrötchen$/i.test(c.name) && c.extras == null ? { ...c, extras: pizzaExtras } : c));
  }
  if (from < 2) {
    categories = categories.map((c) => (/getränk/i.test(c.name) && (c.station ?? 'kitchen') === 'kitchen' ? { ...c, station: 'none' } : c));
  }
  return { ...menu, schema: MENU_SCHEMA, categories, products };
}

function newCart() {
  return { type: state.settings.order.defaultType, customer: null, lines: [], deliveryFee: 0, note: '', dueTime: '' };
}

/** Offene Bestellungen der letzten zwei Tage laden (nach Mitternacht bleibt eine späte Bestellung sichtbar). */
async function loadOpenOrders() {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const lists = await Promise.all([db.ordersByDay(dayKey()), db.ordersByDay(dayKey(yesterday))]);
  return lists.flat().filter(isOpenOrder);
}

function replaceOpen(order) {
  const rest = state.openOrders.filter((o) => o.id !== order.id);
  state.openOrders = isOpenOrder(order) ? [...rest, order] : rest;
  emit();
}

/** Bestellung einen Schritt weiter (oder zurück) setzen: kitchen | out | ready | done */
export async function setStage(order, stage) {
  const updated = { ...order, stage, stageAt: { ...(order.stageAt ?? {}), [stage]: new Date().toISOString() } };
  await db.put('orders', updated);
  replaceOpen(updated);
  return updated;
}

export async function init() {
  try {
    const [settings, menu, customers, cart] = await Promise.all([db.kvGet('settings'), db.kvGet('menu'), db.getAll('customers'), db.kvGet('cart')]);
    state.settings = mergeSettings(settings);
    // Neuer Stand der mitgelieferten Speisekarte wird übernommen, solange hier nichts von Hand geändert wurde.
    const outdated = menu && !menu.edited && menu.source?.rev !== MENU_SOURCE.rev;
    state.menu = menu && !outdated ? migrateMenu(menu) : seedMenu();
    if (state.menu !== menu) await db.kvSet('menu', state.menu);
    state.customers = customers.map(indexCustomer);
    state.cart = { ...newCart(), ...(cart ?? {}) };
    state.openOrders = await loadOpenOrders();
    if (!ORDER_TYPES[state.cart.type]) state.cart.type = state.settings.order.defaultType;
    state.persisted = (await db.requestPersistence()) || (await db.isPersisted());
    state.ready = true;
  } catch (e) {
    console.error(e);
    state.error = e?.message ?? String(e);
  }
  emit();
}

// --- Einstellungen & Speisekarte -------------------------------------------------

export async function saveSettings(section, patch) {
  state.settings = { ...state.settings, [section]: { ...state.settings[section], ...patch } };
  emit();
  await db.kvSet('settings', state.settings);
}

async function saveMenu() {
  state.menu = { ...state.menu, edited: true };
  emit();
  await db.kvSet('menu', state.menu);
}

export async function saveProduct(product) {
  const products = [...state.menu.products];
  if (product.id == null) {
    product.id = 'p' + uid();
    products.push(product);
  } else {
    const i = products.findIndex((p) => p.id === product.id);
    if (i >= 0) products[i] = product;
    else products.push(product);
  }
  state.menu.products = products;
  await saveMenu();
}

export async function deleteProduct(id) {
  state.menu.products = state.menu.products.filter((p) => p.id !== id);
  await saveMenu();
}

export async function saveCategory(cat) {
  const categories = [...state.menu.categories];
  if (cat.id == null) {
    cat.id = 'c' + uid();
    categories.push({ tax: 7, extras: null, isExtras: false, ...cat });
  } else {
    const i = categories.findIndex((c) => c.id === cat.id);
    if (i >= 0) categories[i] = { ...categories[i], ...cat };
  }
  state.menu.categories = categories;
  await saveMenu();
}

export async function deleteCategory(id) {
  state.menu.categories = state.menu.categories.filter((c) => c.id !== id).map((c) => (c.extras === id ? { ...c, extras: null } : c));
  state.menu.products = state.menu.products.filter((p) => p.cat !== id);
  await saveMenu();
}

export async function resetMenu() {
  state.menu = seedMenu();
  emit();
  await db.kvSet('menu', state.menu);
}

// --- Warenkorb ---------------------------------------------------------------------

let cartTimer;
function cartChanged() {
  state.cart = { ...state.cart };
  emit();
  clearTimeout(cartTimer);
  cartTimer = setTimeout(() => db.kvSet('cart', state.cart).catch(console.error), 250);
}

/** Position aus Artikel + gewählter Variante/Extras aufbauen. */
export function makeLine(product, variantIndex = 0, { qty = 1, extras = [], note = '', half = null } = {}) {
  const cat = state.menu.categories.find((c) => c.id === product.cat);
  const [label, price] = product.v[variantIndex] ?? product.v[0];
  if (half) {
    // Halb/halb: Größe gilt für die ganze Pizza, Preis nach Einstellung aus beiden Hälften
    const other = priceForSize(half, label, variantIndex) ?? price;
    const piece = (p) => ({ productId: p.id, nr: p.nr ?? '', name: p.name });
    return {
      ...makeLine(product, variantIndex, { qty, extras, note }),
      nr: '',
      name: 'Pizza halb/halb',
      unitPrice: halfPrice(price, other, state.settings.order.halfPrice),
      halves: [piece(product), piece(half)],
    };
  }
  return {
    key: uid(),
    productId: product.id,
    catId: product.cat,
    nr: product.nr ?? '',
    name: product.name,
    variant: label,
    variantIndex,
    unitPrice: price,
    qty,
    tax: product.tax ?? cat?.tax ?? 7,
    station: categoryStation(cat),
    extras,
    note: note.trim(),
  };
}

export function addLine(line) {
  const existing = state.cart.lines.find((l) => sameLine(l, line));
  if (existing) {
    state.cart.lines = state.cart.lines.map((l) => (l === existing ? { ...l, qty: l.qty + line.qty } : l));
  } else {
    state.cart.lines = [...state.cart.lines, line];
  }
  cartChanged();
}

export function updateLine(key, patch) {
  state.cart.lines = state.cart.lines.map((l) => (l.key === key ? { ...l, ...patch } : l));
  cartChanged();
}

export function changeQty(key, delta) {
  state.cart.lines = state.cart.lines.map((l) => (l.key === key ? { ...l, qty: l.qty + delta } : l)).filter((l) => l.qty > 0);
  cartChanged();
}

export function removeLine(key) {
  state.cart.lines = state.cart.lines.filter((l) => l.key !== key);
  cartChanged();
}

export function setCart(patch) {
  Object.assign(state.cart, patch);
  cartChanged();
}

/**
 * Lieferkosten automatisch setzen (Kunde gewählt, Adresse geändert, auf "Lieferung" gewechselt).
 * feeInfo merkt sich die Herkunft für den Hinweis an der Kasse; von Hand gewählt = 'manual'.
 */
export function applyAutoFee() {
  const cart = state.cart;
  if (cart.type !== 'delivery' || !cart.customer) return;
  const r = autoDeliveryFee(cart.customer, state.settings.order.zones);
  setCart({ deliveryFee: r.fee, feeInfo: { source: r.source, place: r.place ?? '' } });
}

/** Kunde für die aktuelle Bestellung wählen (oder mit null entfernen). */
export function pickCustomer(customer) {
  if (customer) {
    // Neuer Kunde: Lieferkosten immer neu bestimmen
    setCart({ customer, feeInfo: null });
    applyAutoFee();
    return;
  }
  // Kunde entfernt: automatisch gesetzte Lieferkosten gehören zu ihm, von Hand gewählte bleiben stehen.
  const manual = state.cart.feeInfo?.source === 'manual';
  setCart({ customer: null, ...(manual ? {} : { deliveryFee: 0, feeInfo: null }) });
}

/** Lieferkosten von Hand setzen. */
export function setDeliveryFee(fee) {
  setCart({ deliveryFee: fee, feeInfo: { source: 'manual' } });
}

export function setOrderType(type) {
  setCart({ type });
  if (type === 'delivery' && !state.cart.feeInfo) applyAutoFee();
}

export function clearCart() {
  state.cart = newCart();
  cartChanged();
}

export function cartTotals() {
  return orderTotals(state.cart, { deliveryTax: state.settings.order.deliveryTax });
}

// --- Kunden ------------------------------------------------------------------------

const publicCustomer = ({ _phones, _text, ...c }) => c;

export async function saveCustomer(customer) {
  const c = publicCustomer(customer);
  c.updatedAt = new Date().toISOString();
  if (c.id == null) {
    delete c.id;
    c.createdAt = c.updatedAt;
  }
  c.id = await db.put('customers', c);
  const indexed = indexCustomer({ ...c });
  const i = state.customers.findIndex((x) => x.id === c.id);
  state.customers = i >= 0 ? state.customers.map((x, j) => (j === i ? indexed : x)) : [...state.customers, indexed];
  if (state.cart.customer?.id === c.id) {
    const before = state.cart.customer;
    setCart({ customer: publicCustomer(indexed) });
    // Neue Adresse -> Lieferkosten neu bestimmen (von Hand gewählte bleiben)
    if ((before.city !== c.city || before.zip !== c.zip) && state.cart.feeInfo?.source !== 'manual') applyAutoFee();
  }
  emit();
  return indexed;
}

export async function deleteCustomer(id) {
  await db.del('customers', id);
  state.customers = state.customers.filter((c) => c.id !== id);
  emit();
}

/**
 * Kunden importieren.
 * mode 'replace': alle vorhandenen Kunden löschen, dann importieren.
 * mode 'merge':   vorhandene Kunden mit gleicher Telefonnummer aktualisieren, übrige anlegen.
 */
export async function importCustomers(list, mode = 'merge') {
  const now = new Date().toISOString();
  let added = 0;
  let updated = 0;
  const records = [];
  if (mode === 'replace') {
    for (const c of list) records.push({ ...c, createdAt: now, updatedAt: now });
    added = records.length;
  } else {
    const byPhone = new Map();
    for (const c of state.customers) for (const p of c._phones) byPhone.set(p, c);
    for (const c of list) {
      const phone = normPhone(c.phone);
      const old = phone && byPhone.get(phone);
      if (old) {
        // Leere Felder der Importdatei überschreiben vorhandene Angaben nicht.
        const merged = { ...publicCustomer(old), updatedAt: now };
        for (const [k, v] of Object.entries(c)) if (v !== '' && v != null) merged[k] = v;
        records.push(merged);
        updated++;
      } else {
        const rec = { ...c, createdAt: now, updatedAt: now };
        records.push(rec);
        if (phone) byPhone.set(phone, indexCustomer({ ...rec }));
        added++;
      }
    }
  }
  await db.bulkPut('customers', records, { clearFirst: mode === 'replace' });
  state.customers = (await db.getAll('customers')).map(indexCustomer);
  emit();
  return { added, updated };
}

// --- Bestellungen ----------------------------------------------------------------------

/** Warenkorb als Bestellung abschließen. Gibt die gespeicherte Bestellung zurück. */
export async function completeOrder({ payment }) {
  const cart = state.cart;
  const totals = cartTotals();
  const now = new Date();
  const due = cart.dueTime ? timeToday(cart.dueTime, now) : null;
  const order = await db.createOrder({
    createdAt: now.toISOString(),
    day: dayKey(now),
    status: 'done',
    stage: 'kitchen',
    stageAt: { kitchen: now.toISOString() },
    dueAt: due ? due.toISOString() : null,
    type: cart.type,
    customer: cart.customer ? publicCustomer(cart.customer) : null,
    lines: clone(cart.lines),
    note: cart.note.trim(),
    itemsTotal: totals.items,
    deliveryFee: totals.deliveryFee,
    total: totals.total,
    taxes: totals.taxes,
    payment,
  });
  clearCart();
  replaceOpen(order);
  // Lieferkosten beim Kunden merken – für Orte, die in keinem Liefergebiet stehen.
  if (order.type === 'delivery' && order.customer?.id != null) {
    const c = state.customers.find((x) => x.id === order.customer.id);
    if (c && c.lastFee !== order.deliveryFee) saveCustomer({ ...c, lastFee: order.deliveryFee }).catch(console.error);
  }
  return order;
}

export const loadOrders = (day) => db.ordersByDay(day).then((list) => list.sort((a, b) => b.id - a.id));

export async function cancelOrder(order) {
  const updated = { ...order, status: 'cancelled', cancelledAt: new Date().toISOString() };
  await db.put('orders', updated);
  replaceOpen(updated);
  return updated;
}

/** Positionen einer früheren Bestellung erneut in den Warenkorb legen. */
export function reorder(order) {
  state.cart = {
    type: ORDER_TYPES[order.type] ? order.type : state.settings.order.defaultType,
    customer: order.customer ? { ...order.customer } : null,
    lines: order.lines.map((l) => ({ ...clone(l), key: uid() })),
    deliveryFee: order.deliveryFee ?? 0,
    note: '',
    dueTime: '',
  };
  cartChanged();
  setView('pos');
}

// --- Datensicherung ------------------------------------------------------------------

export async function exportBackup() {
  const [customers, orders, counters] = await Promise.all([db.getAll('customers'), db.getAll('orders'), db.kvGet('counters')]);
  return { app: 'pos', version: 1, exportedAt: new Date().toISOString(), settings: state.settings, menu: state.menu, counters, customers, orders };
}

export async function importBackup(data) {
  if (data?.app !== 'pos' || !Array.isArray(data.customers) || !Array.isArray(data.orders)) {
    throw new Error('Das ist keine gültige Sicherungsdatei dieser Kasse.');
  }
  await db.bulkPut('customers', data.customers, { clearFirst: true });
  await db.bulkPut('orders', data.orders, { clearFirst: true });
  await db.kvSet('settings', data.settings ?? {});
  if (data.menu) await db.kvSet('menu', data.menu);
  if (data.counters) await db.kvSet('counters', data.counters);
  await db.kvSet('cart', null);
  await init();
}
