// Star WebPRNT: Druckaufträge per HTTP direkt an den Drucker (mC-Print3 im LAN)
// oder über die iOS-App "Star webPRNT Browser" (Bluetooth / USB / LAN).
//
// Protokoll (entspricht dem offiziellen Star WebPRNT SDK):
//   POST <url>   Content-Type: text/xml; charset=UTF-8
//   <StarWebPrint xmlns="http://www.star-m.jp" ...><Request>[XML-escaptes <root>…</root>]</Request></StarWebPrint>
// Antwort: <Response> mit <success>, <code> und <status> (Hex-Statusbytes).

export const BROWSER_APP_URL = 'http://localhost:8001/StarWebPRNT/SendMessage';

/** URL des WebPRNT-Dienstes aus den Druckereinstellungen ableiten. */
export function endpointUrl(printer) {
  if (printer.driver === 'browser') return BROWSER_APP_URL;
  let host = String(printer.host ?? '').trim();
  if (!host) return '';
  if (/^https?:\/\//i.test(host)) {
    // Vollständige URL eingegeben: nur den Pfad ergänzen, falls er fehlt.
    return /\/StarWebPRNT\//i.test(host) ? host : host.replace(/\/+$/, '') + '/StarWebPRNT/SendMessage';
  }
  host = host.replace(/\/.*$/, '');
  return `${printer.https ? 'https' : 'http'}://${host}/StarWebPRNT/SendMessage`;
}

/**
 * RGBA-Pixel -> 1-Bit-Raster (MSB zuerst, jede Zeile auf volle Bytes aufgefüllt).
 * Ein gesetztes Bit bedeutet einen schwarzen Punkt.
 */
export function packMono(rgba, width, height, threshold = 150) {
  const rowBytes = Math.ceil(width / 8);
  const out = new Uint8Array(rowBytes * height);
  let p = 0;
  for (let y = 0; y < height; y++) {
    const base = y * rowBytes;
    for (let x = 0; x < width; x++, p += 4) {
      const a = rgba[p + 3] / 255;
      // Helligkeit 0..255, transparente Pixel gelten als weiß
      const lum = ((30 * rgba[p] + 59 * rgba[p + 1] + 11 * rgba[p + 2]) / 100) * a + 255 * (1 - a);
      if (lum < threshold) out[base + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return out;
}

export function bytesToBase64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** Canvas -> Druckbild { width, height, base64 } */
export function canvasToImage(canvas) {
  const { width, height } = canvas;
  const rgba = canvas.getContext('2d').getImageData(0, 0, width, height).data;
  return { width, height, base64: bytesToBase64(packMono(rgba, width, height)) };
}

/** Inhalt des <root>-Elements für einen oder mehrere Bons. */
export function buildRequest(images, { cut = true, drawer = false } = {}) {
  let r = '<initialization/>';
  if (drawer) r += '<peripheral channel="1" on="200" off="200"/>';
  for (const img of images) {
    r += `<bitimage width="${img.width}" height="${img.height}">${img.base64}</bitimage>`;
    if (cut) r += '<cutpaper feed="true"/>';
  }
  return r;
}

/** Nur die Schublade öffnen. */
export const drawerRequest = () => '<peripheral channel="1" on="200" off="200"/>';

const xmlEscape = (s) => s.replace(/[<>&]/g, (c) => (c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&amp;'));

export function envelope(request) {
  return (
    '<StarWebPrint xmlns="http://www.star-m.jp" xmlns:i="http://www.w3.org/2001/XMLSchema-instance"><Request>' +
    xmlEscape(`<root>${request}</root>`) +
    '</Request></StarWebPrint>'
  );
}

/** Antworttext (XML, ggf. mit escapten Tags) -> { success, code, status } */
export function parseResponse(text) {
  const t = String(text ?? '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
  const pick = (tag) => new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(t)?.[1] ?? '';
  return { success: pick('success') === 'true', code: pick('code'), status: pick('status') };
}

/** Statusbytes des Druckers in verständliche Meldungen übersetzen. */
export function statusMessages(status) {
  const byte = (i) => parseInt(String(status ?? '').substr(i, 2), 16) || 0;
  const msgs = [];
  if (byte(4) & 0x20) msgs.push('Deckel ist offen');
  if (byte(10) & 0x08) msgs.push('Papier ist leer');
  if (byte(6) & 0x08) msgs.push('Fehler am Papierschneider');
  if (byte(6) & 0x40) msgs.push('Druckkopf zu heiß');
  if (byte(6) & 0x20) msgs.push('Druckerfehler – bitte aus- und wieder einschalten');
  if (!msgs.length && byte(4) & 0x08) msgs.push('Drucker ist offline');
  return msgs;
}

export function paperNearEnd(status) {
  return Boolean((parseInt(String(status ?? '').substr(10, 2), 16) || 0) & 0x04);
}

export class PrintError extends Error {}

// --- Transport -------------------------------------------------------------

// Die App "Star webPRNT Browser" nimmt Aufträge über einen WKWebView-Message-Handler
// entgegen und meldet das Ergebnis über die globale Funktion _onFinish zurück.
const pending = new Map();

function usesAppBridge(url) {
  return (
    typeof navigator !== 'undefined' &&
    /^https?:\/\/(localhost|127\.0\.0\.1):8001\//i.test(url) &&
    navigator.userAgent.includes('webPRNTSupportMessageHandler') &&
    Boolean(globalThis.webkit?.messageHandlers?.sendMessageHandler)
  );
}

if (typeof window !== 'undefined') {
  window._onFinish = (res) => {
    const entry = pending.get(res?.url);
    if (!entry) return;
    pending.delete(res.url);
    clearTimeout(entry.timer);
    if (res.htmlCode == 200) entry.resolve(res.response);
    else entry.reject(new PrintError(`Drucker meldet Fehler ${res.htmlCode}.`));
  };
}

async function sendViaApp(url, body, timeout) {
  // Die App verarbeitet je URL nur einen Auftrag gleichzeitig.
  while (pending.has(url)) await new Promise((r) => setTimeout(r, 300));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(url);
      reject(new PrintError('Zeitüberschreitung – der Drucker antwortet nicht.'));
    }, timeout);
    pending.set(url, { resolve, reject, timer });
    globalThis.webkit.messageHandlers.sendMessageHandler.postMessage(JSON.stringify({ url, body }));
  });
}

async function sendViaHttp(url, body, timeout) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml; charset=UTF-8' },
      body,
      signal: ctrl.signal,
    });
    const txt = await res.text();
    if (!res.ok) throw new PrintError(`Drucker meldet HTTP-Fehler ${res.status}.`);
    return txt;
  } catch (e) {
    if (e instanceof PrintError) throw e;
    if (e.name === 'AbortError') throw new PrintError('Zeitüberschreitung – der Drucker antwortet nicht.');
    const mixed = typeof location !== 'undefined' && location.protocol === 'https:' && url.startsWith('http://');
    throw new PrintError(
      mixed
        ? 'Der Browser blockiert die unverschlüsselte Verbindung zum Drucker (die Kasse läuft über HTTPS). Lösung: App "Star webPRNT Browser" verwenden oder HTTPS am Drucker aktivieren – siehe Einstellungen › Drucker.'
        : 'Drucker nicht erreichbar. Bitte IP-Adresse, WLAN und Stromversorgung prüfen.',
    );
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Auftrag senden. Löst mit { status, paperNearEnd } auf oder wirft PrintError
 * mit einer Meldung, die man dem Personal direkt anzeigen kann.
 */
export async function send(url, request, { timeout = 30000 } = {}) {
  if (!url) throw new PrintError('Kein Drucker eingerichtet (Einstellungen › Drucker).');
  const body = envelope(request);
  let text;
  if (usesAppBridge(url)) {
    text = await sendViaApp(url, body, timeout);
  } else {
    // Wie im SDK: ältere Versionen der App bieten localhost nur über http an.
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
    if (/iPad;|iPhone;|iPod touch;|Android/.test(ua) && !ua.includes('WebPRNTSupportHTTPS')) {
      url = url.replace(/^https:\/\/(localhost|127\.0\.0\.1)/i, 'http://$1');
    }
    text = await sendViaHttp(url, body, timeout);
  }
  const res = parseResponse(text);
  if (!res.success) {
    const msgs = statusMessages(res.status);
    throw new PrintError(msgs.length ? `Druck fehlgeschlagen: ${msgs.join(', ')}.` : `Druck fehlgeschlagen (Code ${res.code || 'unbekannt'}).`);
  }
  return { status: res.status, paperNearEnd: paperNearEnd(res.status) };
}
