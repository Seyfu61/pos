// Kundenverwaltung: Suche, Anlegen/Bearbeiten, CSV-Import und -Export.

import { html, useMemo, useRef, useState, Icon, Modal, saveFile, pickFile, useAppState } from '../lib/ui.js';
import * as store from '../lib/store.js';
import { CUSTOMER_FIELDS, SEARCH_FIELDS, customersToRows, decodeText, guessMapping, looksLikeHeader, parseCsv, rowsToCustomers, searchCustomers, toCsv } from '../lib/csv.js';
import { compareNr, dayKey } from '../lib/util.js';

const address = (c) => [c.street, [c.zip, c.city].filter(Boolean).join(' ')].filter(Boolean).join(', ');

// --- Formular -----------------------------------------------------------------------

export function CustomerForm({ customer, onSaved, onClose }) {
  const [c, setC] = useState({ nr: '', name: '', phone: '', phone2: '', street: '', zip: '', city: '', note: '', ...customer });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setC({ ...c, [k]: e.target.value });
  const valid = c.name.trim() || c.phone.trim();

  const save = async () => {
    setBusy(true);
    try {
      const saved = await store.saveCustomer(Object.fromEntries(Object.entries(c).map(([k, v]) => [k, typeof v === 'string' ? v.trim() : v])));
      onSaved?.(saved);
      onClose();
    } catch (e) {
      store.toast(`Speichern fehlgeschlagen: ${e.message}`, 'error');
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!confirm(`Kunde „${c.name || c.phone}“ wirklich löschen?`)) return;
    await store.deleteCustomer(c.id);
    onClose();
  };
  const input = (k, label, props = {}) =>
    html`<label class="field ${props.wide ? 'wide' : ''}"><span class="field-label">${label}</span>
      <input type=${props.type ?? 'text'} class="input" inputmode=${props.inputmode} autocomplete="off" value=${c[k]} onInput=${set(k)} />
    </label>`;

  return html`<${Modal}
    title=${c.id ? 'Kunde bearbeiten' : 'Neuer Kunde'}
    onClose=${onClose}
    footer=${html`${c.id && html`<button class="btn danger ghost" onClick=${remove}><${Icon} name="trash" /> Löschen</button>`}
      <span class="spacer"></span>
      <button class="btn" onClick=${onClose}>Abbrechen</button>
      <button class="btn primary big" disabled=${!valid || busy} onClick=${save}>Speichern</button>`}
  >
    <div class="form">
      ${input('phone', 'Telefon', { type: 'tel', inputmode: 'tel' })} ${input('phone2', 'Telefon 2 / Mobil', { type: 'tel', inputmode: 'tel' })}
      ${input('name', 'Name', { wide: true })} ${input('street', 'Straße und Hausnummer', { wide: true })}
      ${input('zip', 'PLZ', { inputmode: 'numeric' })} ${input('city', 'Ort')}
      ${input('note', 'Hinweis (erscheint auf dem Bon, z. B. Hinterhaus, 2. Stock)', { wide: true })} ${input('nr', 'Kundennummer')}
    </div>
  <//>`;
}

function CustomerRow({ c, onClick }) {
  return html`<button class="customer-row" onClick=${onClick}>
    <span class="cust-nr">${c.nr || '–'}</span>
    <span class="cust-name"><strong>${c.name || '(ohne Namen)'}</strong>${c.note && html`<em>${c.note}</em>`}</span>
    <span class="cust-addr">${c.street && html`<span>${c.street}</span>`}<span>${[c.zip, c.city].filter(Boolean).join(' ') || (c.street ? '' : '–')}</span></span>
    <span class="cust-phone"><span>${c.phone || '–'}</span>${c.phone2 && html`<span>${c.phone2}</span>`}</span>
  </button>`;
}

/** Gewähltes Suchfeld (bleibt gespeichert). */
function useSearchField() {
  const { settings } = useAppState();
  const field = SEARCH_FIELDS[settings.ui.customerField] ? settings.ui.customerField : 'all';
  return [field, (f) => store.saveSettings('ui', { customerField: f })];
}

/** Suchfeld mit Auswahl, worin gesucht wird. */
function CustomerSearch({ query, setQuery, field, setField, autofocus }) {
  const ref = useRef();
  const choose = (f) => {
    setField(f);
    ref.current?.focus();
  };
  const numeric = field === 'nr' || field === 'phone';
  return html`<div class="customer-search">
    <div class="search">
      <${Icon} name="search" />
      <input
        ref=${ref}
        type="search"
        autofocus=${autofocus}
        autocomplete="off"
        autocorrect="off"
        spellcheck=${false}
        inputmode=${numeric ? (field === 'phone' ? 'tel' : 'numeric') : 'text'}
        placeholder=${field === 'all' ? SEARCH_FIELDS.all.placeholder : `Nur ${SEARCH_FIELDS[field].placeholder} durchsuchen`}
        value=${query}
        onInput=${(e) => setQuery(e.target.value)}
      />
      ${query && html`<button class="btn icon-btn ghost" onClick=${() => (setQuery(''), ref.current?.focus())} aria-label="Suche leeren"><${Icon} name="x" /></button>`}
    </div>
    <div class="search-in" role="radiogroup" aria-label="Suchen in">
      <span class="field-label">Suchen in</span>
      ${Object.entries(SEARCH_FIELDS).map(
        ([key, f]) => html`<button class="chip ${field === key ? 'on' : ''}" role="radio" aria-checked=${field === key} onClick=${() => choose(key)}>${f.label}</button>`,
      )}
    </div>
  </div>`;
}

const COLUMNS = [
  ['nr', 'Nr.'],
  ['name', 'Name'],
  ['address', 'Adresse'],
  ['phone', 'Telefon'],
];

/** Tabelle: Kundennummer | Name | Adresse | Telefon. Spaltenkopf antippen = nur in dieser Spalte suchen. */
function CustomerTable({ customers, onPick, field, setField, children }) {
  return html`<div class="customer-list" role="list">
    <div class="customer-head">
      ${COLUMNS.map(
        ([key, label]) =>
          html`<button class=${field === key ? 'on' : ''} aria-pressed=${field === key} onClick=${() => setField(field === key ? 'all' : key)} title="Nur in dieser Spalte suchen">
            ${label}${field === key && html` <${Icon} name="search" size=${13} />`}
          </button>`,
      )}
    </div>
    ${customers.map((c) => html`<${CustomerRow} key=${c.id} c=${c} onClick=${() => onPick(c)} />`)}
    ${children}
  </div>`;
}

/** Sortierung nach Kundennummer (99 vor 100), Kunden ohne Nummer danach nach Name. */
const byNr = (a, b) => compareNr(String(a.nr ?? ''), String(b.nr ?? '')) || String(a.name).localeCompare(String(b.name), 'de');

// --- Auswahl an der Kasse -------------------------------------------------------------

export function CustomerPicker({ onPick, onClose }) {
  const { customers } = useAppState();
  const [query, setQuery] = useState('');
  const [form, setForm] = useState(null);
  const [field, setField] = useSearchField();
  const sorted = useMemo(() => [...customers].sort(byNr), [customers]);
  const results = useMemo(() => searchCustomers(sorted, query, 30, field), [sorted, query, field]);
  const isNumber = /^[\d\s+\-/()]+$/.test(query.trim());
  // Vorbelegung für "Neuer Kunde" passend zum Suchfeld
  const draft = () => {
    const q = query.trim();
    if (!q) return {};
    if (field === 'nr') return { nr: q };
    if (field === 'address') return { street: q };
    if (field === 'phone' || (field === 'all' && isNumber)) return { phone: q };
    return { name: q };
  };

  if (form) return html`<${CustomerForm} customer=${form} onSaved=${(c) => onPick(stripIndex(c))} onClose=${() => setForm(null)} />`;
  return html`<${Modal}
    title="Kunde wählen"
    size="lg"
    onClose=${onClose}
    footer=${html`<span class="muted small">${customers.length} Kunden gespeichert</span><span class="spacer"></span>
      <button class="btn primary" onClick=${() => setForm(draft())}>
        <${Icon} name="plus" /> Neuer Kunde${query.trim() ? ` „${query.trim()}“` : ''}
      </button>`}
  >
    <${CustomerSearch} query=${query} setQuery=${setQuery} field=${field} setField=${setField} autofocus=${true} />
    <${CustomerTable} customers=${results} field=${field} setField=${setField} onPick=${(c) => onPick(stripIndex(c))}>
      ${results.length === 0 &&
      html`<div class="empty"><p>${customers.length === 0 ? 'Noch keine Kunden gespeichert. Unter „Kunden“ lässt sich eine Liste importieren.' : 'Kein Kunde gefunden.'}</p></div>`}
    <//>
  <//>`;
}

const stripIndex = ({ _phones, _text, ...c }) => c;

// --- Import ------------------------------------------------------------------------------

function ImportWizard({ file, onClose }) {
  const [hasHeader, setHasHeader] = useState(() => looksLikeHeader(file.rows[0]));
  const [mapping, setMapping] = useState(() => (looksLikeHeader(file.rows[0]) ? guessMapping(file.rows[0]) : {}));
  const [mode, setMode] = useState('merge');
  const [busy, setBusy] = useState(false);
  const { customers } = useAppState();

  const dataRows = hasHeader ? file.rows.slice(1) : file.rows;
  const columns = file.rows[0].map((h, i) => ({ index: i, label: hasHeader && h.trim() ? h.trim() : `Spalte ${i + 1}`, sample: dataRows[0]?.[i] ?? '' }));
  const parsed = useMemo(() => rowsToCustomers(dataRows, mapping), [dataRows.length, hasHeader, mapping]);
  const mapped = Object.values(mapping).some((v) => v !== '' && v != null);

  const run = async () => {
    if (mode === 'replace' && customers.length && !confirm(`Wirklich alle ${customers.length} vorhandenen Kunden löschen und durch die Importdatei ersetzen?`)) return;
    setBusy(true);
    try {
      const res = await store.importCustomers(parsed, mode);
      store.toast(`Import fertig: ${res.added} neu${res.updated ? `, ${res.updated} aktualisiert` : ''}.`, 'ok', 6000);
      onClose();
    } catch (e) {
      console.error(e);
      store.toast(`Import fehlgeschlagen: ${e.message}`, 'error');
      setBusy(false);
    }
  };

  return html`<${Modal}
    title="Kunden importieren"
    size="lg"
    onClose=${onClose}
    footer=${html`<span class="muted small">${file.name} · ${dataRows.length} Zeilen</span><span class="spacer"></span>
      <button class="btn" onClick=${onClose}>Abbrechen</button>
      <button class="btn primary big" disabled=${busy || !parsed.length} onClick=${run}>${busy ? 'Importiere …' : `${parsed.length} Kunden importieren`}</button>`}
  >
    <label class="check">
      <input
        type="checkbox"
        checked=${hasHeader}
        onChange=${(e) => {
          setHasHeader(e.target.checked);
          if (e.target.checked && !mapped) setMapping(guessMapping(file.rows[0]));
        }}
      />
      Die erste Zeile enthält Spaltennamen
    </label>
    <h3 class="section-title">Spalten zuordnen</h3>
    <p class="muted small">Welche Spalte der Datei gehört zu welchem Feld? Erkannte Spalten sind schon vorausgewählt.</p>
    <div class="mapping">
      ${CUSTOMER_FIELDS.map(
        (f) =>
          html`<label class="field"><span class="field-label">${f.label}</span>
            <select class="input" value=${mapping[f.key] ?? ''} onChange=${(e) => setMapping({ ...mapping, [f.key]: e.target.value === '' ? '' : +e.target.value })}>
              <option value="">– nicht importieren –</option>
              ${columns.map((col) => html`<option value=${col.index}>${col.label}${col.sample ? ` (z. B. ${String(col.sample).slice(0, 24)})` : ''}</option>`)}
            </select>
          </label>`,
      )}
    </div>
    <h3 class="section-title">Vorschau</h3>
    ${parsed.length === 0
      ? html`<p class="muted">Noch nichts zugeordnet – bitte mindestens Name oder Telefon auswählen.</p>`
      : html`<div class="table-wrap"><table class="table">
          <thead><tr><th>Name</th><th>Telefon</th><th>Adresse</th><th>Notiz</th></tr></thead>
          <tbody>
            ${parsed.slice(0, 5).map((c) => html`<tr><td>${c.name}</td><td>${[c.phone, c.phone2].filter(Boolean).join(' / ')}</td><td>${address(c)}</td><td>${c.note}</td></tr>`)}
          </tbody>
        </table></div>`}
    <h3 class="section-title">Vorhandene Kunden</h3>
    <label class="check"><input type="radio" name="mode" checked=${mode === 'merge'} onChange=${() => setMode('merge')} /> Behalten – gleiche Telefonnummer wird aktualisiert, neue kommen dazu</label>
    <label class="check"><input type="radio" name="mode" checked=${mode === 'replace'} onChange=${() => setMode('replace')} /> Alle löschen und durch diese Datei ersetzen</label>
  <//>`;
}

async function chooseImportFile() {
  const f = await pickFile('.csv,.txt,.tsv,text/csv,text/plain');
  if (!f) return null;
  if (/\.(xlsx?|ods|numbers)$/i.test(f.name)) {
    store.toast('Excel-Dateien bitte zuerst als CSV speichern („Speichern unter … CSV“) und dann importieren.', 'error');
    return null;
  }
  const rows = parseCsv(decodeText(await f.arrayBuffer()));
  if (!rows.length) {
    store.toast('Die Datei enthält keine Daten.', 'error');
    return null;
  }
  // Alle Zeilen auf gleiche Spaltenzahl bringen.
  const width = Math.max(...rows.map((r) => r.length));
  return { name: f.name, rows: rows.map((r) => (r.length < width ? [...r, ...Array(width - r.length).fill('')] : r)) };
}

// --- Kundenliste ----------------------------------------------------------------------------

export function CustomersView() {
  const { customers } = useAppState();
  const [query, setQuery] = useState('');
  const [form, setForm] = useState(null);
  const [importFile, setImportFile] = useState(null);
  const [field, setField] = useSearchField();
  const sorted = useMemo(() => [...customers].sort(byNr), [customers]);
  const results = useMemo(() => searchCustomers(sorted, query, 200, field), [sorted, query, field]);

  const exportCsv = () => saveFile(`kunden-${dayKey()}.csv`, toCsv(customersToRows(sorted)), 'text/csv');

  return html`<div class="page">
    <header class="page-head">
      <h1>Kunden <span class="count">${customers.length}</span></h1>
      <span class="spacer"></span>
      <button class="btn" onClick=${async () => setImportFile(await chooseImportFile())}><${Icon} name="upload" /> Importieren</button>
      <button class="btn" disabled=${!customers.length} onClick=${exportCsv}><${Icon} name="download" /> Exportieren</button>
      <button class="btn primary" onClick=${() => setForm({})}><${Icon} name="plus" /> Neuer Kunde</button>
    </header>
    <div class="page-body">
      ${customers.length === 0
        ? html`<div class="empty big">
            <${Icon} name="users" size=${48} />
            <p>Noch keine Kunden gespeichert.</p>
            <p class="muted">Über „Importieren“ lässt sich eine vorhandene Kundenliste als CSV-Datei einlesen<br />(z. B. aus Excel: Speichern unter › CSV). Die Spalten werden beim Import zugeordnet.</p>
          </div>`
        : html`<${CustomerSearch} query=${query} setQuery=${setQuery} field=${field} setField=${setField} />
          <div class="card top-gap"><${CustomerTable} customers=${results} field=${field} setField=${setField} onPick=${(c) => setForm(stripIndex(c))}>
            ${results.length === 0 && html`<div class="empty"><p>Kein Kunde gefunden.</p></div>`}
            ${results.length === 200 && html`<p class="muted small center">Es werden die ersten 200 Treffer angezeigt – Suche verfeinern.</p>`}
          <//></div>`}
    </div>
    ${form && html`<${CustomerForm} customer=${form} onClose=${() => setForm(null)} />`}
    ${importFile && html`<${ImportWizard} file=${importFile} onClose=${() => setImportFile(null)} />`}
  </div>`;
}
