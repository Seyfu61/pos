// Zentraler App-Zustand + alle Aktionen, die Daten verändern.

import * as db from './db.js';
import { clone, dayKey, normPhone, uid } from './util.js';
import { indexCustomer } from './csv.js';
import { orderTotals, sameLine } from './order.js';
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
  persisted: false,
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

export function setView(view) {
  state.view = view;
  emit();
}

// --- Start ---------------------------------------------------------------------

export function seedMenu() {
  return { source: MENU_SOURCE, categories: clone(CATEGORIES), products: clone(PRODUCTS).map((p) => ({ ...p, active: true })) };
}

function newCart() {
  return { type: state.settings.order.defaultType, customer: null, lines: [], deliveryFee: 0, note: '' };
}

export async function init() {
  try {
    const [settings, menu, customers, cart] = await Promise.all([db.kvGet('settings'), db.kvGet('menu'), db.getAll('customers'), db.kvGet('cart')]);
    state.settings = mergeSettings(settings);
    state.menu = menu ?? seedMenu();
    if (!menu) await db.kvSet('menu', state.menu);
    state.customers = customers.map(indexCustomer);
    state.cart = cart ?? newCart();
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
  state.menu = { ...state.menu };
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
export function makeLine(product, variantIndex = 0, { qty = 1, extras = [], note = '' } = {}) {
  const cat = state.menu.categories.find((c) => c.id === product.cat);
  const [label, price] = product.v[variantIndex] ?? product.v[0];
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
  if (state.cart.customer?.id === c.id) setCart({ customer: publicCustomer(indexed) });
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
export async function completeOrder({ payment, given = null }) {
  const cart = state.cart;
  const totals = cartTotals();
  const now = new Date();
  const order = await db.createOrder({
    createdAt: now.toISOString(),
    day: dayKey(now),
    status: 'done',
    type: cart.type,
    customer: cart.customer ? publicCustomer(cart.customer) : null,
    lines: clone(cart.lines),
    note: cart.note.trim(),
    itemsTotal: totals.items,
    deliveryFee: totals.deliveryFee,
    total: totals.total,
    taxes: totals.taxes,
    payment,
    given,
  });
  clearCart();
  return order;
}

export const loadOrders = (day) => db.ordersByDay(day).then((list) => list.sort((a, b) => b.id - a.id));

export async function cancelOrder(order) {
  const updated = { ...order, status: 'cancelled', cancelledAt: new Date().toISOString() };
  await db.put('orders', updated);
  return updated;
}

/** Positionen einer früheren Bestellung erneut in den Warenkorb legen. */
export function reorder(order) {
  state.cart = {
    type: order.type,
    customer: order.customer ? { ...order.customer } : null,
    lines: order.lines.map((l) => ({ ...clone(l), key: uid() })),
    deliveryFee: order.deliveryFee ?? 0,
    note: '',
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
