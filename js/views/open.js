// Offene Bestellungen: wie lange schon drin, wann fällig, nächster Schritt.

import { html, useMemo, useState, Icon, useAppState, useNow } from '../lib/ui.js';
import * as store from '../lib/store.js';
import { eur, fmtTime } from '../lib/util.js';
import { ORDER_TYPES, STAGES, fmtMinutes, nextStage, orderDue } from '../lib/order.js';
import { lineTitle } from '../print/receipt.js';
import { OrderDetail, PreviewModal } from './orders.js';

const TYPE_ICON = { delivery: 'truck', pickup: 'bag' };

function dueText(d) {
  if (d.level === 'late') return `${fmtMinutes(-d.left)} überfällig`;
  if (d.left === 0) return 'jetzt fällig';
  return `noch ${fmtMinutes(d.left)}`;
}

function OrderCard({ order, now, onOpen }) {
  const { settings } = useAppState();
  const [busy, setBusy] = useState(false);
  const next = nextStage(order);
  const d = orderDue(order, settings.order, now);
  const kitchen = order.stage === 'kitchen';
  const since = order.stageAt?.[order.stage] ? Math.max(0, Math.floor((now - new Date(order.stageAt[order.stage])) / 60000)) : 0;
  const c = order.customer;
  const advance = async (e) => {
    e.stopPropagation();
    setBusy(true);
    try {
      await store.setStage(order, next.stage);
    } catch (err) {
      store.toast(`Speichern fehlgeschlagen: ${err.message}`, 'error');
      setBusy(false);
    }
  };
  const back = async (e) => {
    e.stopPropagation();
    await store.setStage(order, 'kitchen');
  };
  return html`<div class="open-card ${kitchen ? `lvl-${d.level}` : 'lvl-moving'}" role="button" tabindex="0" onClick=${() => onOpen(order)}>
    <div class="open-top">
      <span class="open-nr">#${order.dayNr}</span>
      <span class="open-type"><${Icon} name=${TYPE_ICON[order.type] ?? 'bag'} size=${18} /> ${ORDER_TYPES[order.type] ?? order.type}</span>
      <span class="spacer"></span>
      <span class="open-total">${eur(order.total)}</span>
    </div>
    <div class="open-who">
      <strong>${c?.name || 'ohne Kunde'}</strong>
      ${order.type === 'delivery' && c && html`<span>${[c.street, c.city].filter(Boolean).join(', ')}</span>`}
    </div>
    ${kitchen
      ? html`<div class="open-time">
          <span class="open-due">${d.preorder ? `Vorbestellt ${fmtTime(d.due)}` : `fällig ${fmtTime(d.due)}`} · <strong>${dueText(d)}</strong></span>
          <span class="muted">eingegangen ${fmtTime(order.createdAt)}, seit ${fmtMinutes(d.elapsed)}</span>
        </div>`
      : html`<div class="open-time"><span class="open-due">${STAGES[order.stage]} seit ${fmtMinutes(since)}</span><span class="muted">eingegangen ${fmtTime(order.createdAt)}</span></div>`}
    ${kitchen && html`<div class="open-items">${order.lines.map((l) => `${l.qty}x ${lineTitle(l)}`).join(' · ')}</div>`}
    ${order.note && html`<div class="open-note">» ${order.note}</div>`}
    <div class="open-actions">
      ${!kitchen && html`<button class="btn small ghost" onClick=${back} aria-label="Zurück in die Küche">Zurück</button>`}
      <span class="spacer"></span>
      ${next && html`<button class="btn ${kitchen ? 'primary' : ''}" disabled=${busy} onClick=${advance}>${next.label} <${Icon} name=${kitchen ? 'right' : 'check'} size=${18} /></button>`}
    </div>
  </div>`;
}

export function OpenView() {
  const { openOrders } = useAppState();
  const { settings } = useAppState();
  useNow(20000); // regelmäßig neu zeichnen
  const now = new Date();
  const [selected, setSelected] = useState(null);
  const [preview, setPreview] = useState(null);

  const kitchen = useMemo(
    () =>
      openOrders
        .filter((o) => o.stage === 'kitchen')
        .map((o) => [orderDue(o, settings.order, now).due, o])
        .sort((a, b) => a[0] - b[0] || a[1].id - b[1].id)
        .map((x) => x[1]),
    [openOrders, settings, Math.floor(now / 60000)],
  );
  const moving = useMemo(
    () => openOrders.filter((o) => o.stage !== 'kitchen').sort((a, b) => new Date(a.stageAt?.[a.stage] ?? 0) - new Date(b.stageAt?.[b.stage] ?? 0)),
    [openOrders],
  );
  const late = kitchen.filter((o) => orderDue(o, settings.order, now).level === 'late').length;
  const current = selected && openOrders.find((o) => o.id === selected.id);

  return html`<div class="page">
    <header class="page-head">
      <h1>Offen <span class="count">${openOrders.length}</span></h1>
      ${late > 0 && html`<span class="late-badge">${late} überfällig</span>`}
      <span class="spacer"></span>
      <span class="muted">${fmtTime(now)} Uhr</span>
    </header>
    <div class="page-body open-layout">
      <section>
        <h2 class="col-title">In der Küche <span class="count">${kitchen.length}</span></h2>
        ${kitchen.length === 0 && html`<div class="empty card"><p>Nichts in der Küche.</p></div>`}
        <div class="open-list">${kitchen.map((o) => html`<${OrderCard} key=${o.id} order=${o} now=${now} onOpen=${setSelected} />`)}</div>
      </section>
      <section>
        <h2 class="col-title">Unterwegs / abholbereit <span class="count">${moving.length}</span></h2>
        ${moving.length === 0 && html`<div class="empty card"><p>Keine Bestellung unterwegs.</p></div>`}
        <div class="open-list">${moving.map((o) => html`<${OrderCard} key=${o.id} order=${o} now=${now} onOpen=${setSelected} />`)}</div>
      </section>
    </div>
    ${selected &&
    html`<${OrderDetail} order=${current ?? selected} onClose=${() => setSelected(null)} onChanged=${(o) => setSelected(o)} setPreview=${setPreview} />`}
    ${preview && html`<${PreviewModal} preview=${preview} onClose=${() => setPreview(null)} />`}
  </div>`;
}
