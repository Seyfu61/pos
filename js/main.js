// Einstiegspunkt: App-Rahmen mit Navigation und Meldungen.

import { html, render, Icon, useAppState } from './lib/ui.js';
import * as store from './lib/store.js';
import { PosView } from './views/pos.js';
import { OrdersView } from './views/orders.js';
import { CustomersView } from './views/customers.js';
import { SettingsView } from './views/settings.js';

const NAV = [
  { view: 'pos', label: 'Kasse', icon: 'grid', component: PosView },
  { view: 'orders', label: 'Bestellungen', icon: 'receipt', component: OrdersView },
  { view: 'customers', label: 'Kunden', icon: 'users', component: CustomersView },
  { view: 'settings', label: 'Einstellungen', icon: 'sliders', component: SettingsView },
];

function App() {
  const s = useAppState();
  if (s.error) {
    return html`<div class="boot">
      <h1>Die Kasse konnte nicht gestartet werden</h1>
      <p>${s.error}</p>
      <p class="muted">Im privaten Modus von Safari lassen sich keine Daten speichern. Bitte ein normales Fenster verwenden und die Seite neu laden.</p>
      <button class="btn primary" onClick=${() => location.reload()}>Neu laden</button>
    </div>`;
  }
  if (!s.ready) return html`<div class="boot"><p>Kasse wird geladen …</p></div>`;
  const current = NAV.find((n) => n.view === s.view) ?? NAV[0];
  return html`<div class="app">
    <nav class="rail">
      ${NAV.map(
        (n) =>
          html`<button class="rail-btn ${n === current ? 'on' : ''}" onClick=${() => store.setView(n.view)} aria-current=${n === current ? 'page' : undefined}>
            <${Icon} name=${n.icon} size=${26} /><span>${n.label}</span>
          </button>`,
      )}
    </nav>
    <main class="view"><${current.component} /></main>
    <div class="toasts" aria-live="polite">
      ${s.toasts.map((t) => html`<div class="toast ${t.kind}" key=${t.id} onClick=${() => store.dismissToast(t.id)}>${t.message}</div>`)}
    </div>
  </div>`;
}

render(html`<${App} />`, document.getElementById('app'));
store.init();

// Offline-Betrieb: Service Worker nur über https bzw. localhost verfügbar.
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('Service Worker nicht registriert:', e));
}

// iOS: Doppeltipp-Zoom und Pinch-Zoom verhindern, damit sich die Kasse wie eine App anfühlt.
document.addEventListener('gesturestart', (e) => e.preventDefault());
