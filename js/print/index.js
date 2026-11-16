// Einheitliche Druckschnittstelle für die App: Blöcke rein, Bon raus.

import { paperDots, renderBlocks } from './raster.js';
import { PrintError, buildRequest, canvasToImage, drawerRequest, endpointUrl, send } from './webprnt.js';

export { PrintError };

export const DRIVERS = {
  none: 'Kein Drucker (nur Vorschau)',
  webprnt: 'Star WebPRNT – Netzwerk (IP-Adresse)',
  browser: 'Star webPRNT Browser App (Bluetooth / USB / LAN)',
  system: 'AirPrint / Druckdialog des iPads',
};

export function renderReceipt(blocks, settings) {
  return renderBlocks(blocks, { width: paperDots(settings.printer.paper) });
}

function systemPrint(canvases, paperMm) {
  let root = document.getElementById('print-root');
  if (!root) {
    root = document.createElement('div');
    root.id = 'print-root';
    document.body.appendChild(root);
  }
  root.replaceChildren(
    ...canvases.map((c) => {
      const img = new Image();
      img.src = c.toDataURL('image/png');
      img.style.width = `${paperMm >= 72 ? 72 : 48}mm`;
      return img;
    }),
  );
  const cleanup = () => root.replaceChildren();
  window.addEventListener('afterprint', cleanup, { once: true });
  // Bilder erst dekodieren lassen, sonst druckt Safari leere Seiten.
  return Promise.all([...root.children].map((img) => img.decode?.().catch(() => {}))).then(() => window.print());
}

/**
 * Mehrere Bons (je eine Blockliste) drucken.
 * @returns {Promise<{printed:boolean, paperNearEnd?:boolean}>}
 */
export async function printReceipts(blockLists, settings, { drawer = false } = {}) {
  const p = settings.printer;
  if (!blockLists.length && !drawer) return { printed: false };
  if (p.driver === 'none') return { printed: false };
  const canvases = blockLists.map((b) => renderReceipt(b, settings));
  if (p.driver === 'system') {
    if (canvases.length) await systemPrint(canvases, p.paper);
    return { printed: canvases.length > 0 };
  }
  const request = buildRequest(canvases.map(canvasToImage), { drawer: drawer && p.drawer });
  const res = await send(endpointUrl(p), request);
  return { printed: true, paperNearEnd: res.paperNearEnd };
}

export async function openDrawer(settings) {
  const p = settings.printer;
  if (p.driver !== 'webprnt' && p.driver !== 'browser') throw new PrintError('Die Schublade lässt sich nur über Star WebPRNT öffnen.');
  await send(endpointUrl(p), drawerRequest());
}
