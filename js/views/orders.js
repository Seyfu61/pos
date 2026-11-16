// Bestellübersicht je Tag: Nachdruck, Storno, Tagesbericht.

import { html, useEffect, useMemo, useState, CanvasView, Icon, Modal, useAppState } from '../lib/ui.js';
import * as store from '../lib/store.js';
import { dayKey, eur, fmtDayKey, fmtTime } from '../lib/util.js';
import { ORDER_TYPES, PAYMENTS, daySummary } from '../lib/order.js';
import { customerReceipt, dayReport, kitchenTickets } from '../print/receipt.js';
import { printReceipts, renderReceipt } from '../print/index.js';

const TYPE_ICON = { delivery: 'truck', pickup: 'bag' };

/** Drucken – oder, wenn kein Drucker eingerichtet ist, Vorschau anzeigen. */
export async function printOrPreview(blocks, title, settings, setPreview) {
  // Ein einzelner Bon (Blockliste) oder mehrere Bons (Liste von Blocklisten)
  const lists = Array.isArray(blocks[0]) ? blocks : [blocks];
  if (settings.printer.driver === 'none') {
    setPreview({ title, canvases: lists.map((b) => renderReceipt(b, settings)) });
    return;
  }
  try {
    const res = await printReceipts(lists, settings);
    store.toast(`${title} gedruckt.`, 'ok');
    if (res.paperNearEnd) store.toast('Hinweis: Die Papierrolle ist fast leer.', 'info', 7000);
  } catch (e) {
    console.error(e);
    store.toast(e.message, 'error');
  }
}

export function PreviewModal({ preview, onClose }) {
  return html`<${Modal} title=${preview.title} size="sm" onClose=${onClose}>
    <p class="muted small">Vorschau – es ist noch kein Drucker eingerichtet (Einstellungen › Drucker).</p>
    ${preview.canvases.map((canvas) => html`<${CanvasView} canvas=${canvas} />`)}
  <//>`;
}

function shiftDay(key, delta) {
  const d = new Date(`${key}T12:00:00`);
  d.setDate(d.getDate() + delta);
  return dayKey(d);
}

function OrderDetail({ order, onClose, onChanged, setPreview }) {
  const { settings, menu } = useAppState();
  const canvas = useMemo(() => renderReceipt(customerReceipt(order, settings), settings), [order, settings]);
  const cancelled = order.status === 'cancelled';

  const cancel = async () => {
    if (!confirm(`Bestellung #${order.dayNr} (Bon-Nr. ${order.bonNr}) über ${eur(order.total)} wirklich stornieren?`)) return;
    onChanged(await store.cancelOrder(order));
    store.toast(`Bestellung #${order.dayNr} storniert.`, 'ok');
  };

  return html`<${Modal}
    title=${`Bestellung #${order.dayNr} · Bon-Nr. ${order.bonNr}`}
    size="lg"
    onClose=${onClose}
    footer=${html`
      ${!cancelled && html`<button class="btn danger ghost" onClick=${cancel}><${Icon} name="x" /> Stornieren</button>`}
      <span class="spacer"></span>
      <button class="btn" onClick=${() => (store.reorder(order), onClose())}><${Icon} name="repeat" /> Erneut bestellen</button>
      <button class="btn" onClick=${() => printOrPreview(kitchenTickets(order, menu.categories), 'Küchenbons', settings, setPreview)}><${Icon} name="printer" /> Küchenbons</button>
      <button class="btn primary" onClick=${() => printOrPreview(customerReceipt(order, settings), 'Kundenbon', settings, setPreview)}><${Icon} name="printer" /> Kundenbon</button>
    `}
  >
    <${CanvasView} canvas=${canvas} />
  <//>`;
}

export function OrdersView() {
  const { settings } = useAppState();
  const today = dayKey();
  const [day, setDay] = useState(today);
  const [orders, setOrders] = useState(null);
  const [selected, setSelected] = useState(null);
  const [preview, setPreview] = useState(null);

  useEffect(() => {
    let live = true;
    setOrders(null);
    store
      .loadOrders(day)
      .then((list) => live && setOrders(list))
      .catch((e) => {
        console.error(e);
        store.toast(`Bestellungen konnten nicht geladen werden: ${e.message}`, 'error');
      });
    return () => (live = false);
  }, [day]);

  const sum = useMemo(() => daySummary(orders ?? []), [orders]);
  const replace = (o) => {
    setOrders(orders.map((x) => (x.id === o.id ? o : x)));
    setSelected(o);
  };

  return html`<div class="page">
    <header class="page-head">
      <h1>Bestellungen</h1>
      <div class="day-nav">
        <button class="btn icon-btn" onClick=${() => setDay(shiftDay(day, -1))} aria-label="Vorheriger Tag"><${Icon} name="left" /></button>
        <input type="date" class="input" value=${day} max=${today} onChange=${(e) => e.target.value && setDay(e.target.value)} />
        <button class="btn icon-btn" disabled=${day >= today} onClick=${() => setDay(shiftDay(day, 1))} aria-label="Nächster Tag"><${Icon} name="right" /></button>
        ${day !== today && html`<button class="btn" onClick=${() => setDay(today)}>Heute</button>`}
      </div>
      <span class="spacer"></span>
      <button class="btn" disabled=${!orders?.length} onClick=${() => printOrPreview(dayReport(day, sum, settings), 'Tagesbericht', settings, setPreview)}>
        <${Icon} name="printer" /> Tagesbericht
      </button>
    </header>
    <div class="page-body orders-layout">
      <div class="card order-list">
        ${orders === null && html`<div class="empty"><p>Lade …</p></div>`}
        ${orders?.length === 0 && html`<div class="empty big"><${Icon} name="receipt" size=${48} /><p>Keine Bestellungen am ${fmtDayKey(day)}.</p></div>`}
        ${orders?.map(
          (o) =>
            html`<button class="order-row ${o.status === 'cancelled' ? 'cancelled' : ''}" key=${o.id} onClick=${() => setSelected(o)}>
              <span class="order-nr">#${o.dayNr}</span>
              <span class="order-time">${fmtTime(o.createdAt)}</span>
              <span class="order-type"><${Icon} name=${TYPE_ICON[o.type] ?? 'bag'} size=${18} /> ${ORDER_TYPES[o.type] ?? o.type}</span>
              <span class="order-customer">
                <strong>${o.customer?.name || '–'}</strong>
                <span>${o.type === 'delivery' ? [o.customer?.street, o.customer?.city].filter(Boolean).join(', ') : `${o.lines.reduce((s, l) => s + l.qty, 0)} Artikel`}</span>
              </span>
              <span class="order-pay">${o.status === 'cancelled' ? 'storniert' : PAYMENTS[o.payment]}</span>
              <span class="order-total">${eur(o.total)}</span>
            </button>`,
        )}
      </div>
      <aside class="card summary">
        <h2>Tagesübersicht</h2>
        <p class="muted small">${fmtDayKey(day)}</p>
        <div class="stat"><span>Umsatz</span><strong>${eur(sum.total)}</strong></div>
        <div class="stat-row"><span>Bestellungen</span><span>${sum.count}</span></div>
        ${Object.entries(sum.byPayment).map(([k, v]) => html`<div class="stat-row"><span>${PAYMENTS[k] ?? k} (${v.count})</span><span>${eur(v.total)}</span></div>`)}
        <hr />
        ${Object.entries(sum.byType).map(([k, v]) => html`<div class="stat-row"><span>${ORDER_TYPES[k] ?? k} (${v.count})</span><span>${eur(v.total)}</span></div>`)}
        ${sum.taxes.length > 0 && html`<hr />`}
        ${sum.taxes.map((t) => html`<div class="stat-row"><span>MwSt. ${t.rate} % (aus ${eur(t.gross)})</span><span>${eur(t.tax)}</span></div>`)}
        ${sum.cancelledCount > 0 && html`<hr /><div class="stat-row muted"><span>Storniert (${sum.cancelledCount})</span><span>${eur(sum.cancelledTotal)}</span></div>`}
      </aside>
    </div>
    ${selected && html`<${OrderDetail} order=${selected} onClose=${() => setSelected(null)} onChanged=${replace} setPreview=${setPreview} />`}
    ${preview && html`<${PreviewModal} preview=${preview} onClose=${() => setPreview(null)} />`}
  </div>`;
}
