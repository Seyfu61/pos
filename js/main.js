// Einstiegspunkt: App-Rahmen mit Navigation und Meldungen.

import { html, render, Icon, useAppState, useNow } from './lib/ui.js';
import { orderDue } from './lib/order.js';
import * as store from './lib/store.js';
import { APP_VERSION } from './version.js';
import { PosView } from './views/pos.js';
import { OrdersView } from './views/orders.js';
import { OpenView } from './views/open.js';
import { CustomersView } from './views/customers.js';
import { SettingsView } from './views/settings.js';

const NAV = [
  { view: 'pos', label: 'Kasse', icon: 'grid', component: PosView },
  { view: 'open', label: 'Offen', icon: 'clock', component: OpenView },
  { view: 'orders', label: 'Bestellungen', icon: 'receipt', component: OrdersView },
  { view: 'customers', label: 'Kunden', icon: 'users', component: CustomersView },
  { view: 'settings', label: 'Einstellungen', icon: 'sliders', component: SettingsView },
];

/** Zahl am Menüpunkt "Offen": Bestellungen in der Küche, rot sobald eine überfällig ist. */
function OpenBadge() {
  const { openOrders, settings } = useAppState();
  useNow(20000); // regelmäßig neu zeichnen
  const now = new Date();
  const kitchen = openOrders.filter((o) => o.stage === 'kitchen');
  if (!kitchen.length) return null;
  const late = kitchen.some((o) => orderDue(o, settings.order, now).level === 'late');
  return html`<span class="rail-badge ${late ? 'late' : ''}" aria-label=${`${kitchen.length} in der Küche${late ? ', überfällig' : ''}`}>${kitchen.length}</span>`;
}

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
            <${Icon} name=${n.icon} size=${26} /><span>${n.label}</span>${n.view === 'open' && html`<${OpenBadge} />`}
          </button>`,
      )}
    </nav>
    <main class="view"><${current.component} /></main>
    ${s.updateReady &&
    html`<div class="update-banner" role="status">
      <span>Eine neue Version der Kasse ist da.</span>
      <button class="btn primary" onClick=${() => location.reload()}>Jetzt neu laden</button>
    </div>`}
    <div class="toasts" aria-live="polite">
      ${s.toasts.map((t) => html`<div class="toast ${t.kind}" key=${t.id} onClick=${() => store.dismissToast(t.id)}>${t.message}</div>`)}
    </div>
  </div>`;
}

render(html`<${App} />`, document.getElementById('app'));
store.init();

// Offline-Betrieb und Updates: Service Worker nur über https bzw. localhost verfügbar.
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  let hadController = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // Erste Installation ist kein Update; danach heißt ein neuer Service Worker: neue Version auf dem Server.
    if (!hadController) {
      hadController = true;
      return;
    }
    store.markUpdateReady();
  });
  navigator.serviceWorker
    .register('./sw.js', { updateViaCache: 'none' })
    .then((reg) => {
      const check = () => reg.update().catch(() => {});
      // Als App auf dem Home-Bildschirm lädt sich die Kasse nicht von selbst neu – deshalb regelmäßig nachsehen.
      setInterval(check, 5 * 60 * 1000);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'visible') return;
        check();
        // Zurück in der App und gerade nichts in Arbeit: Update gleich übernehmen.
        if (store.state.updateReady && !store.state.cart.lines.length && !document.querySelector('.overlay')) location.reload();
      });
    })
    .catch((e) => console.warn('Service Worker nicht registriert:', e));
}

window.__kasseVersion = APP_VERSION;

// iOS: Doppeltipp-Zoom und Pinch-Zoom verhindern, damit sich die Kasse wie eine App anfühlt.
document.addEventListener('gesturestart', (e) => e.preventDefault());
