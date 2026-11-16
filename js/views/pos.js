// Kassenbildschirm: Artikel wählen, Bon zusammenstellen, abschließen.

import { html, useEffect, useMemo, useRef, useState, Icon, Modal, MoneyInput, Segmented, Stepper, useAppState } from '../lib/ui.js';
import * as store from '../lib/store.js';
import { compareNr, eur, fold, uid } from '../lib/util.js';
import { ORDER_TYPES, PAYMENTS, extraPrice, lineTotal } from '../lib/order.js';
import { customerReceipt, kitchenTicket } from '../print/receipt.js';
import { printReceipts } from '../print/index.js';
import { CustomerPicker } from './customers.js';

const TYPE_OPTIONS = [
  { value: 'delivery', label: ORDER_TYPES.delivery, icon: 'truck' },
  { value: 'pickup', label: ORDER_TYPES.pickup, icon: 'bag' },
];

const hue = (i) => (i * 47 + 8) % 360;
const EXTRAS_TAB = 'extras';

function priceLabel(p) {
  const prices = p.v.map((v) => v[1]);
  const min = Math.min(...prices);
  return prices.some((x) => x !== min) ? `ab ${eur(min)}` : eur(min);
}

// --- Artikel-Dialog: Größe, Extras, Notiz ------------------------------------------

function LineEditor({ product, line, onClose }) {
  const { menu } = useAppState();
  const cat = menu.categories.find((c) => c.id === (product?.cat ?? line?.catId));
  const extrasList = useMemo(
    () => (cat?.extras != null ? menu.products.filter((p) => p.cat === cat.extras && p.active !== false) : []),
    [menu, cat],
  );
  const [variant, setVariant] = useState(line?.variantIndex ?? 0);
  const [qty, setQty] = useState(line?.qty ?? 1);
  const [note, setNote] = useState(line?.note ?? '');
  // Gewählte Extras als Namen – der Preis richtet sich nach der aktuellen Größe.
  const [chosen, setChosen] = useState(() => new Set((line?.extras ?? []).map((e) => e.name)));

  const priceOf = (extra) => (product ? extraPrice(extra, product, variant) : extra.v[0][1]);
  const extras = [
    ...extrasList.filter((e) => chosen.has(e.name)).map((e) => ({ id: e.id, name: e.name, price: priceOf(e) })),
    // Extras, die es in der Speisekarte nicht mehr gibt, bleiben an der Position erhalten.
    ...(line?.extras ?? []).filter((e) => chosen.has(e.name) && !extrasList.some((x) => x.name === e.name)),
  ];
  const base = product ? (product.v[variant] ?? product.v[0])[1] : line.unitPrice;
  const total = (base + extras.reduce((s, e) => s + e.price, 0)) * qty;

  const toggle = (name) => {
    const next = new Set(chosen);
    next.has(name) ? next.delete(name) : next.add(name);
    setChosen(next);
  };

  const save = () => {
    if (line) {
      const patch = product ? store.makeLine(product, variant, { qty, extras, note }) : { qty, extras, note: note.trim() };
      store.updateLine(line.key, { ...patch, key: line.key });
    } else {
      store.addLine(store.makeLine(product, variant, { qty, extras, note }));
    }
    onClose();
  };

  const title = [product?.nr ?? line?.nr, product?.name ?? line?.name].filter(Boolean).join(' · ');
  return html`<${Modal}
    title=${title}
    onClose=${onClose}
    size=${extrasList.length > 8 ? 'lg' : 'md'}
    footer=${html`
      ${line &&
      html`<button
        class="btn danger ghost"
        onClick=${() => {
          store.removeLine(line.key);
          onClose();
        }}
      >
        <${Icon} name="trash" /> Entfernen
      </button>`}
      <span class="spacer"></span>
      <${Stepper} value=${qty} onChange=${setQty} />
      <button class="btn primary big" onClick=${save}>${line ? 'Übernehmen' : 'Hinzufügen'} · ${eur(total)}</button>
    `}
  >
    ${product?.desc && html`<p class="muted editor-desc">${product.desc}</p>`}
    ${product &&
    product.v.length > 1 &&
    html`<div class="variants">
      ${product.v.map(
        ([label, price], i) =>
          html`<button class="variant ${i === variant ? 'on' : ''}" onClick=${() => setVariant(i)}>
            <strong>${label || 'Standard'}</strong><span>${eur(price)}</span>
          </button>`,
      )}
    </div>`}
    ${extrasList.length > 0 &&
    html`<h3 class="section-title">Extras</h3>
      <div class="extras">
        ${extrasList.map(
          (e) =>
            html`<button class="extra ${chosen.has(e.name) ? 'on' : ''}" onClick=${() => toggle(e.name)}>
              <span>${e.name}</span><span class="extra-price">+${eur(priceOf(e), { symbol: false })}</span>
            </button>`,
        )}
      </div>`}
    <h3 class="section-title">Notiz für die Küche</h3>
    <input type="text" class="input" placeholder="z. B. ohne Zwiebeln, gut durch …" value=${note} onInput=${(e) => setNote(e.target.value)} />
  <//>`;
}

// --- Freier Artikel -------------------------------------------------------------------

function CustomItem({ onClose }) {
  const [name, setName] = useState('');
  const [price, setPrice] = useState(null);
  const [tax, setTax] = useState(7);
  const ok = name.trim() && price != null && price >= 0;
  const add = () => {
    store.addLine({ key: uid(), productId: null, catId: null, nr: '', name: name.trim(), variant: '', variantIndex: 0, unitPrice: price, qty: 1, tax, extras: [], note: '' });
    onClose();
  };
  return html`<${Modal}
    title="Freier Artikel"
    onClose=${onClose}
    size="sm"
    footer=${html`<span class="spacer"></span><button class="btn primary big" disabled=${!ok} onClick=${add}>Hinzufügen</button>`}
  >
    <div class="form">
      <label class="field wide"><span class="field-label">Bezeichnung</span>
        <input type="text" class="input" value=${name} onInput=${(e) => setName(e.target.value)} />
      </label>
      <label class="field"><span class="field-label">Preis (€)</span>
        <${MoneyInput} value=${price} onCommit=${setPrice} onLive=${setPrice} />
      </label>
      <div class="field"><span class="field-label">MwSt.</span>
        <${Segmented} options=${[{ value: 7, label: '7 %' }, { value: 19, label: '19 %' }]} value=${tax} onChange=${setTax} />
      </div>
    </div>
  <//>`;
}

// --- Abschluss ------------------------------------------------------------------------

function Checkout({ onClose }) {
  const { cart, settings } = useAppState();
  const totals = store.cartTotals();
  const [payment, setPayment] = useState('cash');
  const [printCustomer, setPrintCustomer] = useState(settings.printer.printCustomer);
  const [printKitchen, setPrintKitchen] = useState(settings.printer.printKitchen);
  const [busy, setBusy] = useState(false);
  const hasPrinter = settings.printer.driver !== 'none';

  const finish = async () => {
    if (busy) return;
    setBusy(true);
    let order;
    try {
      order = await store.completeOrder({ payment });
    } catch (e) {
      console.error(e);
      store.toast(`Bestellung konnte nicht gespeichert werden: ${e.message}`, 'error');
      setBusy(false);
      return;
    }
    onClose();
    const jobs = [];
    if (printKitchen) jobs.push(kitchenTicket(order));
    if (printCustomer) jobs.push(customerReceipt(order, settings));
    try {
      const res = await printReceipts(jobs, settings, { drawer: payment === 'cash' });
      store.toast(`Bestellung #${order.dayNr} gespeichert${res.printed ? ' und gedruckt' : hasPrinter ? '' : ' (kein Drucker eingerichtet)'}.`, 'ok');
      if (res.paperNearEnd) store.toast('Hinweis: Die Papierrolle ist fast leer.', 'info', 7000);
    } catch (e) {
      console.error(e);
      store.toast(`Bestellung #${order.dayNr} ist gespeichert, aber: ${e.message} Unter „Bestellungen“ kann der Bon erneut gedruckt werden.`, 'error', 12000);
    }
  };

  return html`<${Modal}
    title="Bestellung abschließen"
    onClose=${onClose}
    size="sm"
    footer=${html`<button class="btn" onClick=${onClose}>Zurück</button><span class="spacer"></span>
      <button class="btn primary big" disabled=${busy} onClick=${finish}><${Icon} name="check" /> ${hasPrinter ? 'Abschließen & drucken' : 'Abschließen'}</button>`}
  >
    <div class="checkout-total"><span>${ORDER_TYPES[cart.type]} · ${totals.count} Artikel</span><strong>${eur(totals.total)}</strong></div>
    ${cart.type === 'delivery' && !cart.customer?.street && html`<p class="warn">Achtung: Es ist noch keine Lieferadresse ausgewählt.</p>`}
    ${cart.type === 'delivery' && totals.deliveryFee === 0 && html`<p class="warn">Hinweis: Es sind keine Lieferkosten berechnet.</p>`}
    <h3 class="section-title">Zahlung</h3>
    <${Segmented} options=${Object.entries(PAYMENTS).map(([value, label]) => ({ value, label }))} value=${payment} onChange=${setPayment} />
    <h3 class="section-title">Drucken</h3>
    <label class="check"><input type="checkbox" checked=${printKitchen} onChange=${(e) => setPrintKitchen(e.target.checked)} /> Küchenbon</label>
    <label class="check"><input type="checkbox" checked=${printCustomer} onChange=${(e) => setPrintCustomer(e.target.checked)} /> Kundenbon</label>
    ${!hasPrinter && html`<p class="muted small">Noch kein Drucker eingerichtet – die Bestellung wird gespeichert und kann später unter „Bestellungen“ gedruckt werden.</p>`}
  <//>`;
}

// --- Bon (rechte Spalte) ----------------------------------------------------------------

function Ticket({ onEdit, onCustomer, onCheckout }) {
  const { cart, settings } = useAppState();
  const totals = store.cartTotals();
  const listRef = useRef();
  const count = cart.lines.length;
  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [count]);
  const c = cart.customer;

  return html`<aside class="ticket">
    <div class="ticket-head">
      <${Segmented} options=${TYPE_OPTIONS} value=${cart.type} onChange=${(type) => store.setCart({ type })} />
      <button class="customer-btn ${c ? 'has' : ''}" onClick=${onCustomer}>
        <${Icon} name=${c ? 'user' : 'phone'} />
        ${c
          ? html`<span class="customer-info">
              <strong>${c.name || c.phone || 'Kunde'}</strong>
              <span>${[c.street, [c.zip, c.city].filter(Boolean).join(' ')].filter(Boolean).join(', ') || c.phone}</span>
              ${c.note && html`<em>${c.note}</em>`}
            </span>`
          : html`<span class="customer-info"><strong>Kunde wählen</strong><span>Telefonnummer oder Name suchen</span></span>`}
        ${c &&
        html`<span
          class="customer-clear"
          role="button"
          aria-label="Kunde entfernen"
          onClick=${(e) => {
            e.stopPropagation();
            store.setCart({ customer: null });
          }}
          ><${Icon} name="x" size=${18}
        /></span>`}
      </button>
    </div>

    <div class="ticket-lines" ref=${listRef}>
      ${count === 0 && html`<div class="empty"><${Icon} name="receipt" size=${40} /><p>Noch keine Artikel.<br />Artikel antippen oder Nummer eingeben.</p></div>`}
      ${cart.lines.map(
        (l) =>
          html`<div class="line" key=${l.key}>
            <div class="line-qty">
              <button class="qty-btn" onClick=${() => store.changeQty(l.key, -1)} aria-label="Weniger"><${Icon} name=${l.qty === 1 ? 'trash' : 'minus'} size=${16} /></button>
              <span>${l.qty}</span>
              <button class="qty-btn" onClick=${() => store.changeQty(l.key, 1)} aria-label="Mehr"><${Icon} name="plus" size=${16} /></button>
            </div>
            <button class="line-main" onClick=${() => onEdit(l)}>
              <span class="line-title">${l.nr && html`<span class="nr">${l.nr}</span>`} ${l.name} ${l.variant && html`<span class="line-variant">${l.variant}</span>`}</span>
              ${l.extras.length > 0 && html`<span class="line-extras">${l.extras.map((e) => `+ ${e.name}`).join(', ')}</span>`}
              ${l.note && html`<span class="line-note">» ${l.note}</span>`}
            </button>
            <div class="line-price">${eur(lineTotal(l), { symbol: false })}</div>
          </div>`,
      )}
    </div>

    <div class="ticket-foot">
      <input
        type="text"
        class="input note-input"
        placeholder="Notiz zur Bestellung (z. B. 19:30 Uhr, klingeln bei …)"
        value=${cart.note}
        onInput=${(e) => store.setCart({ note: e.target.value })}
      />
      ${cart.type === 'delivery' &&
      html`<div class="fee">
        <span class="fee-label">Lieferkosten</span>
        <div class="chips">
          ${settings.order.deliveryFees.map(
            (f) => html`<button class="chip ${cart.deliveryFee === f ? 'on' : ''}" onClick=${() => store.setCart({ deliveryFee: cart.deliveryFee === f ? 0 : f })}>${f === 0 ? 'frei' : eur(f, { symbol: false })}</button>`,
          )}
          <${MoneyInput} value=${cart.deliveryFee === 0 || settings.order.deliveryFees.includes(cart.deliveryFee) ? null : cart.deliveryFee} onCommit=${(v) => store.setCart({ deliveryFee: Math.max(0, v ?? 0) })} placeholder="Betrag" aria-label="Lieferkosten frei eingeben" />
        </div>
      </div>`}
      <div class="totals">
        ${totals.deliveryFee > 0 && html`<div class="total-row"><span>Zwischensumme</span><span>${eur(totals.items)}</span></div>
          <div class="total-row"><span>Lieferkosten</span><span>${eur(totals.deliveryFee)}</span></div>`}
        <div class="total-row grand"><span>Summe</span><span>${eur(totals.total)}</span></div>
      </div>
      <div class="ticket-actions">
        <button
          class="btn"
          disabled=${count === 0 && !c && !cart.note}
          onClick=${() => (count === 0 || confirm('Aktuelle Bestellung wirklich verwerfen?')) && store.clearCart()}
          aria-label="Bestellung verwerfen"
        >
          <${Icon} name="trash" />
        </button>
        <button class="btn primary big grow" disabled=${count === 0} onClick=${onCheckout}>Abschließen · ${eur(totals.total)}</button>
      </div>
    </div>
  </aside>`;
}

// --- Hauptansicht -----------------------------------------------------------------------

export function PosView() {
  const { menu } = useAppState();
  const [catId, setCatId] = useState(null);
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState(null); // { product, line }
  const [dialog, setDialog] = useState(null); // 'customer' | 'checkout' | 'custom'
  const searchRef = useRef();

  const cats = menu.categories;
  // Reine Extras-Kategorien teilen sich einen Reiter – das spart Platz in der Leiste.
  const mainCats = cats.filter((c) => !c.isExtras);
  const extrasIds = new Set(cats.filter((c) => c.isExtras).map((c) => c.id));
  const showExtras = catId === EXTRAS_TAB && extrasIds.size > 0;
  const activeCat = showExtras ? null : (mainCats.find((c) => c.id === catId) ?? mainCats[0] ?? cats[0]);
  const q = fold(query.trim());

  const products = useMemo(() => {
    const active = menu.products.filter((p) => p.active !== false);
    if (!q) return active.filter((p) => (showExtras ? extrasIds.has(p.cat) : p.cat === activeCat?.id));
    const hits = active.filter((p) => fold(p.nr).startsWith(q) || fold(p.name).includes(q));
    // Exakte Artikelnummer zuerst, dann nach Nummer sortiert.
    return hits.sort((a, b) => (fold(b.nr) === q) - (fold(a.nr) === q) || compareNr(a.nr, b.nr));
  }, [menu, activeCat, showExtras, q]);

  const pick = (product) => {
    if (product.v.length > 1) setEditing({ product });
    else store.addLine(store.makeLine(product));
  };

  const onSearchKey = (e) => {
    if (e.key !== 'Enter' || !q) return;
    const exact = products.filter((p) => fold(p.nr) === q);
    const target = exact.length === 1 ? exact[0] : products.length === 1 ? products[0] : null;
    if (target) {
      pick(target);
      setQuery('');
    }
  };

  const editLine = (line) => setEditing({ line, product: menu.products.find((p) => p.id === line.productId) });
  const catIndex = (id) => cats.findIndex((c) => c.id === id);

  return html`<div class="pos">
    <section class="pos-main">
      <div class="pos-top">
        <div class="search">
          <${Icon} name="search" />
          <input
            ref=${searchRef}
            type="search"
            enterkeyhint="done"
            autocomplete="off"
            autocorrect="off"
            spellcheck=${false}
            placeholder="Artikel-Nr. oder Name – Enter fügt hinzu"
            value=${query}
            onInput=${(e) => setQuery(e.target.value)}
            onKeyDown=${onSearchKey}
          />
          ${query && html`<button class="btn icon-btn ghost" onClick=${() => (setQuery(''), searchRef.current?.focus())} aria-label="Suche leeren"><${Icon} name="x" /></button>`}
        </div>
        <button class="btn" onClick=${() => setDialog('custom')}><${Icon} name="plus" /> Freier Artikel</button>
      </div>
      <nav class="cats">
        ${mainCats.map(
          (c) =>
            html`<button class="cat ${!q && c.id === activeCat?.id ? 'on' : ''}" style=${`--hue:${hue(catIndex(c.id))}`} onClick=${() => (setCatId(c.id), setQuery(''))}>
              ${c.name}
            </button>`,
        )}
        ${extrasIds.size > 0 &&
        html`<button class="cat plain extras-cat ${!q && showExtras ? 'on' : ''}" onClick=${() => (setCatId(EXTRAS_TAB), setQuery(''))}>Extras</button>`}
      </nav>
      <div class="products">
        ${products.length === 0 && html`<div class="empty"><p>${q ? `Kein Artikel für „${query}“ gefunden.` : 'In dieser Kategorie gibt es keine Artikel.'}</p></div>`}
        ${products.map(
          (p) =>
            html`<button class="product" key=${p.id} style=${`--hue:${hue(catIndex(p.cat))}`} onClick=${() => pick(p)}>
              <span class="product-top">${p.nr ? html`<span class="nr">${p.nr}</span>` : html`<span></span>`}<span class="product-price">${priceLabel(p)}</span></span>
              <span class="product-name">${p.name}</span>
              ${(p.desc || extrasIds.has(p.cat)) && html`<span class="product-desc">${p.desc || cats[catIndex(p.cat)]?.name}</span>`}
            </button>`,
        )}
      </div>
    </section>

    <${Ticket} onEdit=${editLine} onCustomer=${() => setDialog('customer')} onCheckout=${() => setDialog('checkout')} />

    ${editing && html`<${LineEditor} product=${editing.product} line=${editing.line} onClose=${() => setEditing(null)} />`}
    ${dialog === 'custom' && html`<${CustomItem} onClose=${() => setDialog(null)} />`}
    ${dialog === 'checkout' && html`<${Checkout} onClose=${() => setDialog(null)} />`}
    ${dialog === 'customer' &&
    html`<${CustomerPicker}
      onClose=${() => setDialog(null)}
      onPick=${(customer) => {
        store.setCart({ customer });
        setDialog(null);
      }}
    />`}
  </div>`;
}
