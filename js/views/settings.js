// Einstellungen: Betrieb, Drucker, Bestellung, Speisekarte, Datensicherung.

import { html, useMemo, useState, CanvasView, Field, Icon, Modal, MoneyInput, Segmented, TextInput, pickFile, saveFile, useAppState } from '../lib/ui.js';
import * as store from '../lib/store.js';
import { APP_VERSION } from '../version.js';
import { forceUpdate } from '../lib/update.js';
import { compareNr, dayKey, eur, fmtDayKey, parseEur } from '../lib/util.js';
import { HALF_PRICE_MODES, ORDER_TYPES, STATION_SIDES, categoryStation } from '../lib/order.js';
import { DRIVERS, openDrawer, printReceipts, renderReceipt } from '../print/index.js';
import { endpointUrl } from '../print/webprnt.js';
import { paperDots } from '../print/raster.js';
import { KITCHEN_SIZE_LABELS, kitchenTickets, sampleOrder, testPage } from '../print/receipt.js';

const TABS = [
  { value: 'shop', label: 'Betrieb' },
  { value: 'printer', label: 'Drucker' },
  { value: 'order', label: 'Bestellung' },
  { value: 'menu', label: 'Speisekarte' },
  { value: 'data', label: 'Daten' },
];

// --- Betrieb -----------------------------------------------------------------------

function ShopTab() {
  const { settings } = useAppState();
  const s = settings.shop;
  const set = (k) => (v) => store.saveSettings('shop', { [k]: v });
  return html`<section class="card pad">
    <h2>Angaben auf dem Bon</h2>
    <div class="form">
      <${Field} label="Name" wide><${TextInput} class="input" value=${s.name} onCommit=${set('name')} /><//>
      <${Field} label="Straße"><${TextInput} class="input" value=${s.line1} onCommit=${set('line1')} /><//>
      <${Field} label="PLZ und Ort"><${TextInput} class="input" value=${s.line2} onCommit=${set('line2')} /><//>
      <${Field} label="Telefon"><${TextInput} class="input" value=${s.phone} onCommit=${set('phone')} /><//>
      <${Field} label="Steuernummer / USt-IdNr." hint="Wird so gedruckt wie eingegeben, z. B. „St.-Nr. 20/123/45678“.">
        <${TextInput} class="input" value=${s.taxId} onCommit=${set('taxId')} placeholder="St.-Nr. …" />
      <//>
      <label class="field wide"><span class="field-label">Fußzeile</span>
        <textarea class="input" rows="3" value=${s.footer} onBlur=${(e) => e.target.value !== s.footer && set('footer')(e.target.value)}></textarea>
      </label>
    </div>
  </section>`;
}

// --- Drucker -----------------------------------------------------------------------

function PrinterTab() {
  const { settings } = useAppState();
  const p = settings.printer;
  const [busy, setBusy] = useState(false);
  const set = (patch) => store.saveSettings('printer', patch);
  const star = p.driver === 'webprnt' || p.driver === 'browser';
  const url = endpointUrl(p);
  const mixed = p.driver === 'webprnt' && location.protocol === 'https:' && url.startsWith('http://');
  const preview = useMemo(() => renderReceipt(testPage(settings, paperDots(p.paper)), settings), [settings]);
  const kitchenPreview = useMemo(
    () => kitchenTickets(sampleOrder(), [], { size: p.kitchenSize }).map((t) => renderReceipt(t, settings)),
    [settings],
  );
  const testKitchen = async () => {
    setBusy(true);
    try {
      const res = await printReceipts(kitchenTickets(sampleOrder(), [], { size: p.kitchenSize }), settings);
      store.toast(res.printed ? 'Test-Küchenbons gesendet.' : 'Kein Drucker ausgewählt.', res.printed ? 'ok' : 'info');
    } catch (e) {
      console.error(e);
      store.toast(e.message, 'error', 12000);
    }
    setBusy(false);
  };

  const test = async () => {
    setBusy(true);
    try {
      const res = await printReceipts([testPage(settings, paperDots(p.paper))], settings);
      store.toast(res.printed ? 'Testdruck gesendet.' : 'Kein Drucker ausgewählt.', res.printed ? 'ok' : 'info');
      if (res.paperNearEnd) store.toast('Hinweis: Die Papierrolle ist fast leer.', 'info', 7000);
    } catch (e) {
      console.error(e);
      store.toast(e.message, 'error', 12000);
    }
    setBusy(false);
  };
  const drawer = () => openDrawer(settings).then(() => store.toast('Schublade geöffnet.', 'ok'), (e) => store.toast(e.message, 'error'));

  return html`<div class="split">
    <section class="card pad">
      <h2>Bondrucker</h2>
      <div class="form">
        <label class="field wide"><span class="field-label">Anschlussart</span>
          <select class="input" value=${p.driver} onChange=${(e) => set({ driver: e.target.value })}>
            ${Object.entries(DRIVERS).map(([k, label]) => html`<option value=${k}>${label}</option>`)}
          </select>
        </label>

        ${p.driver === 'webprnt' &&
        html`<${Field} label="IP-Adresse des Druckers" hint=${url ? `Adresse: ${url}` : 'z. B. 192.168.178.50 – steht auf dem Selbsttest-Ausdruck des Druckers.'}>
            <${TextInput} class="input" inputmode="url" autocapitalize="off" autocorrect="off" placeholder="192.168.178.50" value=${p.host} onCommit=${(host) => set({ host: host.trim() })} />
          <//>
          <label class="check field"><input type="checkbox" checked=${p.https} onChange=${(e) => set({ https: e.target.checked })} /> Verschlüsselt verbinden (HTTPS)</label>`}

        <div class="field"><span class="field-label">Kundenbon – Anzahl je Bestellung</span>
          <${Segmented} options=${[1, 2, 3].map((n) => ({ value: n, label: `${n}×` }))} value=${p.customerCopies ?? 1} onChange=${(customerCopies) => set({ customerCopies })} />
        </div>
        <div class="field wide"><span class="field-label">Schrift Küchenbon</span>
          <${Segmented} options=${Object.entries(KITCHEN_SIZE_LABELS).map(([value, label]) => ({ value, label }))} value=${p.kitchenSize ?? 'large'} onChange=${(kitchenSize) => set({ kitchenSize })} />
        </div>
        <div class="field"><span class="field-label">Papierbreite</span>
          <${Segmented} options=${[{ value: 80, label: '80 mm (mC-Print3)' }, { value: 58, label: '58 mm' }]} value=${p.paper} onChange=${(paper) => set({ paper })} />
        </div>
        <div class="field wide">
          <label class="check"><input type="checkbox" checked=${p.printKitchen} onChange=${(e) => set({ printKitchen: e.target.checked })} /> Küchenbons drucken (Pizzaseite und Küchenseite getrennt)</label>
          <label class="check"><input type="checkbox" checked=${p.printCustomer} onChange=${(e) => set({ printCustomer: e.target.checked })} /> Kundenbon drucken</label>
          <label class="check"><input type="checkbox" checked=${p.mapsQr !== false} onChange=${(e) => set({ mapsQr: e.target.checked })} /> Google-Maps-QR-Code mit der Lieferadresse auf dem Kundenbon</label>
          ${star && html`<label class="check"><input type="checkbox" checked=${p.drawer} onChange=${(e) => set({ drawer: e.target.checked })} /> Kassenschublade bei jeder Bestellung öffnen</label>`}
        </div>
      </div>

      ${mixed &&
      html`<p class="warn">
        Die Kasse läuft über eine verschlüsselte Adresse (https). Safari blockiert dann die unverschlüsselte Verbindung zum Drucker.
        Bitte „Verschlüsselt verbinden“ einschalten (dafür muss HTTPS am Drucker aktiviert und sein Zertifikat auf dem iPad als vertrauenswürdig
        installiert sein) – oder einfacher die Anschlussart „Star webPRNT Browser App“ verwenden.
      </p>`}

      <div class="btn-row">
        <button class="btn primary" disabled=${busy || p.driver === 'none'} onClick=${test}><${Icon} name="printer" /> ${busy ? 'Sende …' : 'Testdruck'}</button>
        <button class="btn" disabled=${busy || p.driver === 'none'} onClick=${testKitchen}><${Icon} name="printer" /> Küchenbon testen</button>
        ${star && html`<button class="btn" onClick=${drawer}>Schublade öffnen</button>`}
      </div>

      <div class="help">
        ${p.driver === 'none' && html`<p>Ohne Drucker werden Bons nur als Vorschau angezeigt. Bestellungen werden trotzdem gespeichert.</p>`}
        ${p.driver === 'webprnt' &&
        html`<h3>So geht’s</h3>
          <ol>
            <li>Drucker per LAN-Kabel oder WLAN ins gleiche Netz wie das iPad bringen.</li>
            <li>IP-Adresse ermitteln: Drucker ausschalten, FEED-Taste gedrückt halten und einschalten – die Adresse steht auf dem Ausdruck. Am besten im Router fest vergeben.</li>
            <li>IP-Adresse oben eintragen und „Testdruck“ antippen.</li>
          </ol>`}
        ${p.driver === 'browser' &&
        html`<h3>So geht’s</h3>
          <ol>
            <li>Die kostenlose App <strong>Star webPRNT Browser</strong> aus dem App Store installieren.</li>
            <li>Drucker mit dem iPad verbinden (Bluetooth koppeln, USB-Kabel oder LAN).</li>
            <li>In der iPad-App „Einstellungen“ › „Star webPRNT“ den Drucker (mC-Print3) wählen, „Use Custom URL“ einschalten und bei HOME URL die Adresse dieser Kasse eintragen.</li>
            <li>Die Kasse künftig in dieser App öffnen und „Testdruck“ antippen.</li>
          </ol>
          <p class="muted small">Die Daten der Kasse liegen dann in dieser App – vor einem Wechsel zwischen Safari und der App unter „Daten“ eine Sicherung erstellen und dort wieder einlesen.</p>`}
        ${p.driver === 'system' &&
        html`<p>Es öffnet sich der Druckdialog des iPads. Der mC-Print3 muss dafür per AirPrint im gleichen Netz erreichbar sein. Kassenschublade und automatischer Druck ohne Rückfrage sind auf diesem Weg nicht möglich.</p>`}
      </div>
    </section>
    <section class="card pad preview-card">
      <h2>Vorschau Küchenbons</h2>
      <p class="muted small">Schrift „${KITCHEN_SIZE_LABELS[p.kitchenSize] ?? 'Groß'}“ – Beispielbestellung</p>
      ${kitchenPreview.map((c) => html`<${CanvasView} canvas=${c} />`)}
      <h2 class="top-gap">Vorschau Testdruck</h2>
      <${CanvasView} canvas=${preview} />
    </section>
  </div>`;
}

// --- Bestellung --------------------------------------------------------------------

function OrderTab() {
  const { settings } = useAppState();
  const o = settings.order;
  const set = (patch) => store.saveSettings('order', patch);
  const feesText = o.deliveryFees.map((f) => eur(f, { symbol: false })).join('; ');
  const setFees = (text) => {
    const fees = [...new Set(text.split(/[;\s]+/).map(parseEur).filter((c) => c != null && c >= 0))].sort((a, b) => a - b);
    set({ deliveryFees: fees });
  };
  return html`<section class="card pad">
    <h2>Bestellung</h2>
    <div class="form">
      <div class="field wide"><span class="field-label">Standard-Bestellart</span>
        <${Segmented} options=${Object.entries(ORDER_TYPES).map(([value, label]) => ({ value, label }))} value=${o.defaultType} onChange=${(defaultType) => set({ defaultType })} />
      </div>
      <${Field} label="Lieferkosten – Schnellauswahl (€)" hint="Mehrere Beträge mit Semikolon trennen, z. B. 1,80; 2,50; 3,50. Andere Beträge lassen sich an der Kasse frei eingeben." wide>
        <${TextInput} class="input" value=${feesText} onCommit=${setFees} />
      <//>
      <label class="field"><span class="field-label">Zielzeit Lieferung (Minuten bis raus)</span>
        <input type="number" inputmode="numeric" min="5" max="240" class="input" value=${o.prepMinutes.delivery}
          onChange=${(e) => +e.target.value > 0 && set({ prepMinutes: { ...o.prepMinutes, delivery: Math.round(+e.target.value) } })} />
      </label>
      <label class="field"><span class="field-label">Zielzeit Abholung (Minuten bis fertig)</span>
        <input type="number" inputmode="numeric" min="5" max="240" class="input" value=${o.prepMinutes.pickup}
          onChange=${(e) => +e.target.value > 0 && set({ prepMinutes: { ...o.prepMinutes, pickup: Math.round(+e.target.value) } })} />
      </label>
      <label class="field"><span class="field-label">„Bald fällig“ (orange) ab Minuten vorher</span>
        <input type="number" inputmode="numeric" min="0" max="60" class="input" value=${o.soonMinutes}
          onChange=${(e) => e.target.value !== '' && +e.target.value >= 0 && set({ soonMinutes: Math.round(+e.target.value) })} />
      </label>
      <div class="field wide"><span class="field-label">Preis bei Pizza halb/halb</span>
        <${Segmented} options=${Object.entries(HALF_PRICE_MODES).map(([value, label]) => ({ value, label }))} value=${o.halfPrice ?? 'max'} onChange=${(halfPrice) => set({ halfPrice })} />
      </div>
      <div class="field"><span class="field-label">MwSt. auf Lieferkosten</span>
        <${Segmented} options=${[{ value: 7, label: '7 %' }, { value: 19, label: '19 %' }]} value=${o.deliveryTax} onChange=${(deliveryTax) => set({ deliveryTax })} />
      </div>
    </div>
    <p class="muted small">Den MwSt.-Satz der Artikel legen Sie je Kategorie unter „Speisekarte“ fest (Voreinstellung: Speisen 7 %, Getränke 19 %).</p>
    <${Zones} />
  </section>`;
}

function Zones() {
  const { settings } = useAppState();
  const zones = settings.order.zones ?? [];
  const save = (next) => store.saveSettings('order', { zones: next });
  const update = (i, patch) => save(zones.map((z, j) => (j === i ? { ...z, ...patch } : z)));
  const parsePlaces = (text) => [...new Set(text.split(/[,;\n]+/).map((p) => p.trim()).filter(Boolean))];
  return html`<h3 class="section-title">Liefergebiete – Lieferkosten automatisch</h3>
    <p class="muted small">
      Beim Auswählen eines Kunden werden die Lieferkosten nach seinem Ort gesetzt. Orte mit Komma oder je Zeile trennen; eine
      fünfstellige Zahl gilt als PLZ (z. B. 37085). Der Ortsname muss im Feld „Ort“ des Kunden vorkommen – „Rosdorf-Obernjesa“
      passt also zu „Obernjesa“. Steht ein Ort nirgends, gelten die Lieferkosten der letzten Lieferung an diesen Kunden;
      sonst werden sie an der Kasse gewählt.
    </p>
    ${zones.map(
      (z, i) =>
        html`<div class="zone-row" key=${i}>
          <${MoneyInput} value=${z.fee} onCommit=${(fee) => fee != null && update(i, { fee })} aria-label="Lieferkosten" />
          <textarea
            class="input"
            rows="2"
            placeholder="Orte eintragen, mit Komma getrennt"
            value=${(z.places ?? []).join(', ')}
            onBlur=${(e) => update(i, { places: parsePlaces(e.target.value) })}
          ></textarea>
          <button class="btn icon-btn ghost" onClick=${() => save(zones.filter((_, j) => j !== i))} aria-label="Liefergebiet entfernen"><${Icon} name="trash" /></button>
        </div>`,
    )}
    <button class="btn" onClick=${() => save([...zones, { fee: 0, places: [] }])}><${Icon} name="plus" /> Liefergebiet</button>`;
}

// --- Speisekarte -----------------------------------------------------------------------

function ProductForm({ product, onClose }) {
  const { menu } = useAppState();
  const [p, setP] = useState(() => ({ nr: '', name: '', desc: '', active: true, ...product, v: (product.v?.length ? product.v : [['', null]]).map((v) => [...v]) }));
  const setV = (i, j, val) => setP({ ...p, v: p.v.map((v, k) => (k === i ? (j ? [v[0], val] : [val, v[1]]) : v)) });
  const valid = p.name.trim() && p.v.length && p.v.every((v) => v[1] != null && v[1] >= 0);
  const save = async () => {
    await store.saveProduct({ ...p, nr: p.nr.trim(), name: p.name.trim(), desc: p.desc.trim(), v: p.v.map(([l, c]) => [l.trim(), c]) });
    onClose();
  };
  const remove = async () => {
    if (!confirm(`Artikel „${p.name}“ wirklich löschen?`)) return;
    await store.deleteProduct(p.id);
    onClose();
  };
  return html`<${Modal}
    title=${p.id != null ? 'Artikel bearbeiten' : 'Neuer Artikel'}
    onClose=${onClose}
    footer=${html`${p.id != null && html`<button class="btn danger ghost" onClick=${remove}><${Icon} name="trash" /> Löschen</button>`}
      <span class="spacer"></span><button class="btn" onClick=${onClose}>Abbrechen</button>
      <button class="btn primary big" disabled=${!valid} onClick=${save}>Speichern</button>`}
  >
    <div class="form">
      <label class="field"><span class="field-label">Artikelnummer</span><input type="text" class="input" value=${p.nr} onInput=${(e) => setP({ ...p, nr: e.target.value })} /></label>
      <label class="field"><span class="field-label">Kategorie</span>
        <select class="input" value=${p.cat} onChange=${(e) => setP({ ...p, cat: menu.categories.find((c) => String(c.id) === e.target.value).id })}>
          ${menu.categories.map((c) => html`<option value=${c.id}>${c.name}</option>`)}
        </select>
      </label>
      <label class="field wide"><span class="field-label">Name</span><input type="text" class="input" value=${p.name} onInput=${(e) => setP({ ...p, name: e.target.value })} /></label>
      <label class="field wide"><span class="field-label">Beschreibung</span><input type="text" class="input" value=${p.desc} onInput=${(e) => setP({ ...p, desc: e.target.value })} /></label>
    </div>
    <h3 class="section-title">Größen und Preise</h3>
    ${p.v.map(
      (v, i) =>
        html`<div class="variant-row" key=${i}>
          <input type="text" class="input" placeholder=${p.v.length > 1 ? 'Größe, z. B. 30cm' : 'Größe (optional)'} value=${v[0]} onInput=${(e) => setV(i, 0, e.target.value)} />
          <${MoneyInput} value=${v[1]} onCommit=${(c) => setV(i, 1, c)} onLive=${(c) => setV(i, 1, c)} />
          <span class="muted">€</span>
          <button class="btn icon-btn ghost" disabled=${p.v.length === 1} onClick=${() => setP({ ...p, v: p.v.filter((_, k) => k !== i) })} aria-label="Größe entfernen"><${Icon} name="trash" /></button>
        </div>`,
    )}
    <button class="btn" onClick=${() => setP({ ...p, v: [...p.v, ['', null]] })}><${Icon} name="plus" /> Weitere Größe</button>
    <label class="check top-gap"><input type="checkbox" checked=${p.active !== false} onChange=${(e) => setP({ ...p, active: e.target.checked })} /> An der Kasse anzeigen</label>
  <//>`;
}

function CategoryForm({ category, onClose }) {
  const { menu } = useAppState();
  const [c, setC] = useState({ name: '', tax: 7, extras: null, isExtras: false, ...category });
  const save = async () => {
    await store.saveCategory({ ...c, name: c.name.trim() });
    onClose();
  };
  const remove = async () => {
    const n = menu.products.filter((p) => p.cat === c.id).length;
    if (!confirm(`Kategorie „${c.name}“${n ? ` mit ${n} Artikeln` : ''} wirklich löschen?`)) return;
    await store.deleteCategory(c.id);
    onClose();
  };
  return html`<${Modal}
    title=${c.id != null ? 'Kategorie bearbeiten' : 'Neue Kategorie'}
    size="sm"
    onClose=${onClose}
    footer=${html`${c.id != null && html`<button class="btn danger ghost" onClick=${remove}><${Icon} name="trash" /> Löschen</button>`}
      <span class="spacer"></span><button class="btn primary big" disabled=${!c.name.trim()} onClick=${save}>Speichern</button>`}
  >
    <div class="form">
      <label class="field wide"><span class="field-label">Name</span><input type="text" class="input" value=${c.name} onInput=${(e) => setC({ ...c, name: e.target.value })} /></label>
      <div class="field wide"><span class="field-label">MwSt.-Satz</span>
        <${Segmented} options=${[{ value: 7, label: '7 %' }, { value: 19, label: '19 %' }]} value=${c.tax} onChange=${(tax) => setC({ ...c, tax })} />
      </div>
      <div class="field wide"><span class="field-label">Küchenbon</span>
        <${Segmented} options=${Object.entries(STATION_SIDES).map(([value, label]) => ({ value, label }))} value=${categoryStation(c)} onChange=${(station) => setC({ ...c, station })} />
      </div>
      <label class="field wide"><span class="field-label">Extras aus Kategorie</span>
        <select class="input" value=${c.extras ?? ''} onChange=${(e) => setC({ ...c, extras: menu.categories.find((x) => String(x.id) === e.target.value)?.id ?? null })}>
          <option value="">– keine –</option>
          ${menu.categories.filter((x) => x.id !== c.id).map((x) => html`<option value=${x.id}>${x.name}</option>`)}
        </select>
      </label>
    </div>
  <//>`;
}

function MenuTab() {
  const { menu } = useAppState();
  const [catId, setCatId] = useState(menu.categories[0]?.id);
  const [form, setForm] = useState(null);
  const [catForm, setCatForm] = useState(null);
  const cat = menu.categories.find((c) => c.id === catId) ?? menu.categories[0];
  const products = useMemo(() => menu.products.filter((p) => p.cat === cat?.id), [menu, cat]);
  const reset = async () => {
    if (!confirm('Speisekarte auf den importierten Stand zurücksetzen? Eigene Änderungen an Artikeln und Preisen gehen verloren.')) return;
    await store.resetMenu();
    store.toast('Speisekarte zurückgesetzt.', 'ok');
  };
  return html`<section class="card pad">
    <div class="row-head">
      <h2>Speisekarte <span class="count">${menu.products.length}</span></h2>
      <span class="spacer"></span>
      <button class="btn" onClick=${() => setCatForm({})}><${Icon} name="plus" /> Kategorie</button>
      <button class="btn primary" disabled=${!cat} onClick=${() => setForm({ cat: cat.id })}><${Icon} name="plus" /> Artikel</button>
    </div>
    <nav class="cats">
      ${menu.categories.map((c) => html`<button class="cat plain ${c.id === cat?.id ? 'on' : ''}" onClick=${() => setCatId(c.id)}>${c.name}</button>`)}
    </nav>
    ${cat &&
    html`<div class="row-head sub">
        <span class="muted">MwSt. ${cat.tax} % · ${categoryStation(cat) === 'none' ? 'kein Küchenbon' : `Küchenbon: ${STATION_SIDES[categoryStation(cat)]}`}${cat.extras != null ? ` · Extras aus „${menu.categories.find((c) => c.id === cat.extras)?.name ?? '?'}“` : ''}</span>
        <button class="btn small" onClick=${() => setCatForm(cat)}><${Icon} name="edit" size=${16} /> Kategorie bearbeiten</button>
      </div>
      <div class="table-wrap">
        <table class="table clickable">
          <thead><tr><th>Nr.</th><th>Name</th><th>Größen und Preise</th><th></th></tr></thead>
          <tbody>
            ${[...products].sort((a, b) => compareNr(a.nr, b.nr)).map(
              (p) =>
                html`<tr key=${p.id} class=${p.active === false ? 'inactive' : ''} onClick=${() => setForm(p)}>
                  <td><span class="nr">${p.nr || '–'}</span></td>
                  <td><strong>${p.name}</strong>${p.desc && html`<div class="muted small">${p.desc}</div>`}</td>
                  <td>${p.v.map(([l, c]) => (l ? `${l}: ${eur(c, { symbol: false })}` : eur(c, { symbol: false }))).join(' · ')}</td>
                  <td>${p.active === false ? 'ausgeblendet' : ''}</td>
                </tr>`,
            )}
          </tbody>
        </table>
      </div>`}
    <div class="btn-row">
      <button class="btn danger ghost" onClick=${reset}>Speisekarte zurücksetzen</button>
      ${menu.source && html`<span class="muted small">Importiert am ${fmtDayKey(menu.source.fetchedAt)} von bringstar.jetzt</span>`}
    </div>
    ${form && html`<${ProductForm} product=${form} onClose=${() => setForm(null)} />`}
    ${catForm && html`<${CategoryForm} category=${catForm} onClose=${() => setCatForm(null)} />`}
  </section>`;
}

// --- Daten ---------------------------------------------------------------------------

function DataTab() {
  const { customers, persisted } = useAppState();
  const backup = async () => {
    try {
      await saveFile(`kasse-sicherung-${dayKey()}.json`, JSON.stringify(await store.exportBackup()), 'application/json');
    } catch (e) {
      store.toast(`Sicherung fehlgeschlagen: ${e.message}`, 'error');
    }
  };
  const restore = async () => {
    const f = await pickFile('.json,application/json');
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (!confirm(`Sicherung vom ${String(data.exportedAt ?? '').slice(0, 10)} einlesen? Alle aktuellen Daten auf diesem Gerät (Kunden, Bestellungen, Einstellungen) werden ersetzt.`)) return;
      await store.importBackup(data);
      store.toast('Sicherung eingelesen.', 'ok');
    } catch (e) {
      store.toast(`Einlesen fehlgeschlagen: ${e.message}`, 'error');
    }
  };
  return html`<section class="card pad">
    <div class="version-row">
      <span>Version <strong>${APP_VERSION}</strong></span>
      <button
        class="btn"
        onClick=${async () => {
          try {
            await forceUpdate();
          } catch (e) {
            store.toast(e.message, 'error');
          }
        }}
      >
        <${Icon} name="repeat" /> Nach Update suchen und neu laden
      </button>
    </div>
    <h2>Datensicherung</h2>
    <p>
      Alle Daten (Kunden, Bestellungen, Speisekarte, Einstellungen) liegen <strong>nur auf diesem Gerät</strong>. Bitte regelmäßig sichern –
      z. B. jeden Abend – und die Datei in iCloud Drive oder per AirDrop/E-Mail ablegen.
    </p>
    <div class="btn-row">
      <button class="btn primary" onClick=${backup}><${Icon} name="download" /> Sicherung erstellen</button>
      <button class="btn" onClick=${restore}><${Icon} name="upload" /> Sicherung einlesen</button>
    </div>
    <ul class="facts">
      <li>${customers.length} Kunden gespeichert</li>
      <li>
        Schutz vor automatischem Löschen durch den Browser:
        <strong> ${persisted ? 'aktiv' : 'nicht bestätigt'}</strong>
        ${!persisted && html` – die Kasse über „Teilen › Zum Home-Bildschirm“ installieren, dann behält das iPad die Daten dauerhaft.`}
      </li>
    </ul>
    <p class="muted small">Kundenlisten werden im Bereich „Kunden“ importiert und exportiert.</p>
  </section>`;
}

export function SettingsView() {
  const [tab, setTab] = useState('shop');
  return html`<div class="page">
    <header class="page-head">
      <h1>Einstellungen</h1>
      <${Segmented} options=${TABS} value=${tab} onChange=${setTab} />
    </header>
    <div class="page-body">
      ${tab === 'shop' && html`<${ShopTab} />`} ${tab === 'printer' && html`<${PrinterTab} />`} ${tab === 'order' && html`<${OrderTab} />`}
      ${tab === 'menu' && html`<${MenuTab} />`} ${tab === 'data' && html`<${DataTab} />`}
    </div>
  </div>`;
}
