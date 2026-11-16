// Gemeinsame UI-Bausteine (Preact + htm, ohne Build-Schritt).

import { html, useEffect, useLayoutEffect, useRef, useState } from '../../vendor/preact-htm.js';
import { getVersion, state, subscribe } from './store.js';
import { eur, parseEur } from './util.js';

export * from '../../vendor/preact-htm.js';

/** Komponente bei jeder Zustandsänderung neu zeichnen. */
export function useAppState() {
  const [, tick] = useState(0);
  const seen = getVersion();
  useLayoutEffect(() => {
    const update = () => tick((n) => n + 1);
    // Hat sich zwischen Zeichnen und Anmelden etwas geändert (z. B. Daten fertig geladen)? Dann nachziehen.
    if (getVersion() !== seen) update();
    return subscribe(update);
  }, []);
  return state;
}

const ICONS = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  receipt: '<path d="M5 3h14v18l-2.5-1.8L14 21l-2-1.8L10 21l-2.5-1.8L5 21z"/><path d="M9 8h6M9 12h6"/>',
  users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  sliders: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6"/>',
  printer: '<path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 14h12v8H6z"/>',
  phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  truck: '<path d="M1 4h14v12H1zM15 8h4l4 4v4h-8z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>',
  bag: '<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><path d="M3 6h18M16 10a4 4 0 0 1-8 0"/>',
  home: '<path d="m3 10 9-7 9 7v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  repeat: '<path d="m17 1 4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>',
  left: '<path d="m15 18-6-6 6-6"/>',
  right: '<path d="m9 18 6-6-6-6"/>',
};

export function Icon({ name, size = 22 }) {
  return html`<svg
    class="icon"
    width=${size}
    height=${size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    dangerouslySetInnerHTML=${{ __html: ICONS[name] ?? '' }}
  />`;
}

export function Modal({ title, onClose, children, footer, size = 'md' }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return html`<div class="overlay" onPointerDown=${(e) => e.target === e.currentTarget && onClose?.()}>
    <div class="modal modal-${size}" role="dialog" aria-modal="true" aria-label=${title}>
      <header class="modal-head">
        <h2>${title}</h2>
        <button class="btn icon-btn ghost" onClick=${onClose} aria-label="Schließen"><${Icon} name="x" /></button>
      </header>
      <div class="modal-body">${children}</div>
      ${footer && html`<footer class="modal-foot">${footer}</footer>`}
    </div>
  </div>`;
}

export function Field({ label, hint, children, wide }) {
  return html`<label class="field ${wide ? 'wide' : ''}">
    <span class="field-label">${label}</span>
    ${children} ${hint && html`<span class="field-hint">${hint}</span>`}
  </label>`;
}

/** Texteingabe, die erst beim Verlassen des Feldes speichert. */
export function TextInput({ value, onCommit, ...rest }) {
  const [v, setV] = useState(value ?? '');
  useEffect(() => setV(value ?? ''), [value]);
  return html`<input
    type="text"
    ...${rest}
    value=${v}
    onInput=${(e) => setV(e.target.value)}
    onBlur=${() => v !== (value ?? '') && onCommit(v)}
    onKeyDown=${(e) => e.key === 'Enter' && e.target.blur()}
  />`;
}

/**
 * Betragseingabe in Euro; alle Werte in Cent.
 * onCommit: beim Verlassen des Feldes, onLive: bei jeder Eingabe (null = nicht lesbar/leer).
 */
export function MoneyInput({ value, onCommit, onLive, placeholder = '0,00', ...rest }) {
  const show = (c) => (c == null ? '' : eur(c, { symbol: false }));
  const [v, setV] = useState(show(value));
  const focused = useRef(false);
  // Während des Tippens nicht umformatieren.
  useEffect(() => {
    if (!focused.current) setV(show(value));
  }, [value]);
  return html`<input
    type="text"
    inputmode="decimal"
    class="money-input"
    placeholder=${placeholder}
    ...${rest}
    value=${v}
    onInput=${(e) => {
      setV(e.target.value);
      onLive?.(parseEur(e.target.value));
    }}
    onFocus=${(e) => {
      focused.current = true;
      e.target.select();
    }}
    onBlur=${() => {
      focused.current = false;
      const c = parseEur(v);
      setV(show(c ?? (v.trim() === '' ? null : value)));
      if (c !== value && (c != null || v.trim() === '')) onCommit?.(c);
    }}
    onKeyDown=${(e) => e.key === 'Enter' && e.target.blur()}
  />`;
}

export function Stepper({ value, onChange, min = 1 }) {
  return html`<div class="stepper">
    <button class="btn icon-btn" onClick=${() => onChange(Math.max(min, value - 1))} aria-label="Weniger"><${Icon} name="minus" /></button>
    <span class="stepper-value">${value}</span>
    <button class="btn icon-btn" onClick=${() => onChange(value + 1)} aria-label="Mehr"><${Icon} name="plus" /></button>
  </div>`;
}

export function Segmented({ options, value, onChange }) {
  return html`<div class="segmented" role="tablist">
    ${options.map(
      (o) =>
        html`<button role="tab" aria-selected=${o.value === value} class=${o.value === value ? 'on' : ''} onClick=${() => onChange(o.value)}>
          ${o.icon && html`<${Icon} name=${o.icon} size=${18} />`} ${o.label}
        </button>`,
    )}
  </div>`;
}

/** Zeigt ein fertig gezeichnetes Canvas (Bon-Vorschau) an. */
export function CanvasView({ canvas }) {
  const ref = useRef();
  useEffect(() => {
    if (ref.current && canvas) ref.current.replaceChildren(canvas);
  }, [canvas]);
  return html`<div class="receipt-preview" ref=${ref}></div>`;
}

/** Datei speichern: auf dem iPad über das Teilen-Menü, sonst als Download. */
export async function saveFile(name, content, type) {
  const blob = new Blob([content], { type });
  const file = new File([blob], name, { type });
  const touch = navigator.maxTouchPoints > 1;
  if (touch && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return;
    } catch (e) {
      if (e.name === 'AbortError') return;
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

/** Datei über den Dateidialog wählen. */
export function pickFile(accept) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.style.display = 'none';
    document.body.appendChild(input);
    input.onchange = () => {
      resolve(input.files[0] ?? null);
      input.remove();
    };
    input.oncancel = () => {
      resolve(null);
      input.remove();
    };
    input.click();
  });
}
