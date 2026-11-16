// Dünne Promise-Schicht über IndexedDB. Alle Daten liegen lokal auf dem Gerät.

const DB_NAME = 'pos';
const DB_VERSION = 1;

let dbPromise;

function open() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      if (!db.objectStoreNames.contains('customers')) db.createObjectStore('customers', { keyPath: 'id', autoIncrement: true });
      if (!db.objectStoreNames.contains('orders')) {
        const s = db.createObjectStore('orders', { keyPath: 'id', autoIncrement: true });
        s.createIndex('day', 'day');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('Datenbank ist in einem anderen Tab blockiert.'));
  });
  return dbPromise;
}

const wrap = (req) =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

/** Führt fn(stores...) in einer Transaktion aus und wartet auf deren Abschluss. */
async function tx(names, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(names, mode);
    let result;
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error ?? new Error('Transaktion abgebrochen'));
    Promise.resolve(fn(...[].concat(names).map((n) => t.objectStore(n))))
      .then((r) => (result = r))
      .catch((e) => {
        try {
          t.abort();
        } catch {}
        reject(e);
      });
  });
}

export const kvGet = (key) => tx('kv', 'readonly', (s) => wrap(s.get(key)));
export const kvSet = (key, value) => tx('kv', 'readwrite', (s) => wrap(s.put(value, key)));

export const getAll = (store) => tx(store, 'readonly', (s) => wrap(s.getAll()));
export const put = (store, value) => tx(store, 'readwrite', (s) => wrap(s.put(value)));
export const del = (store, id) => tx(store, 'readwrite', (s) => wrap(s.delete(id)));
export const clear = (store) => tx(store, 'readwrite', (s) => wrap(s.clear()));
export const count = (store) => tx(store, 'readonly', (s) => wrap(s.count()));

/** Viele Datensätze in einer Transaktion schreiben; gibt die vergebenen IDs zurück. */
export function bulkPut(store, values, { clearFirst = false } = {}) {
  return tx(store, 'readwrite', async (s) => {
    if (clearFirst) s.clear();
    const ids = [];
    for (const v of values) ids.push(wrap(s.put(v)));
    return Promise.all(ids);
  });
}

export const ordersByDay = (day) => tx('orders', 'readonly', (s) => wrap(s.index('day').getAll(day)));

/**
 * Bestellung speichern und dabei fortlaufende Bon-Nummer sowie Tagesnummer vergeben –
 * beides in derselben Transaktion, damit keine Nummer doppelt oder verloren geht.
 */
export function createOrder(order) {
  return tx(['kv', 'orders'], 'readwrite', async (kv, orders) => {
    const c = (await wrap(kv.get('counters'))) ?? { bon: 0, day: '', dayNr: 0 };
    c.bon += 1;
    c.dayNr = c.day === order.day ? c.dayNr + 1 : 1;
    c.day = order.day;
    order.bonNr = c.bon;
    order.dayNr = c.dayNr;
    kv.put(c, 'counters');
    order.id = await wrap(orders.add(order));
    return order;
  });
}

/** Browser bitten, die Daten nicht automatisch zu löschen. */
export async function requestPersistence() {
  try {
    if (navigator.storage?.persist) return await navigator.storage.persist();
  } catch {}
  return false;
}

export async function isPersisted() {
  try {
    return (await navigator.storage?.persisted?.()) ?? false;
  } catch {
    return false;
  }
}
