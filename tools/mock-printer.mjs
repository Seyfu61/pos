#!/usr/bin/env node
// Drucker-Attrappe zum Testen ohne Gerät: nimmt Star-WebPRNT-Aufträge an und
// speichert jeden Bon als PNG-Datei.
//
//   node tools/mock-printer.mjs [port] [ausgabeordner]
//
// In der Kasse unter Einstellungen › Drucker "Star WebPRNT – Netzwerk" wählen
// und als Adresse z. B. "localhost:8091" eintragen.

import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
};

const unescapeXml = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/** WebPRNT-Anfrage zerlegen: Liste der Elemente in Druckreihenfolge. */
export function parseJob(body) {
  const inner = /<Request>([\s\S]*)<\/Request>/.exec(body)?.[1];
  if (inner == null) throw new Error('Kein <Request>-Element');
  const root = unescapeXml(inner);
  if (!/^<root[\s>]/.test(root) || !root.endsWith('</root>')) throw new Error('Kein <root>-Element');
  const elements = [];
  for (const m of root.matchAll(/<(\w+)((?:\s+\w+="[^"]*")*)\s*(?:\/>|>([^<]*)<\/\1>)/g)) {
    if (m[1] === 'root') continue;
    const attrs = Object.fromEntries([...m[2].matchAll(/(\w+)="([^"]*)"/g)].map((a) => [a[1], a[2]]));
    elements.push({ tag: m[1], attrs, text: m[3] ?? '' });
  }
  return elements;
}

function crc32(buf) {
  let c;
  let crc = ~0;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return ~crc >>> 0;
}

/** 1-Bit-Raster (gesetztes Bit = schwarz) als PNG kodieren. */
export function monoToPng(width, height, bits) {
  const rowBytes = Math.ceil(width / 8);
  if (bits.length !== rowBytes * height) throw new Error(`Bilddaten passen nicht: ${bits.length} Bytes statt ${rowBytes * height}`);
  const raw = Buffer.alloc((rowBytes + 1) * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < rowBytes; x++) raw[y * (rowBytes + 1) + 1 + x] = ~bits[y * rowBytes + x] & 0xff; // PNG: 1 = weiß
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 1; // Bittiefe
  ihdr[9] = 0; // Graustufen
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

export function startMockPrinter({ port = 8091, outDir = 'bons', log = console.log } = {}) {
  const jobs = [];
  let seq = 0;
  const server = createServer((req, res) => {
    if (req.method === 'OPTIONS') return res.writeHead(204, CORS).end();
    if (req.method !== 'POST' || !req.url.startsWith('/StarWebPRNT/SendMessage')) return res.writeHead(404, CORS).end();
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      let success = true;
      try {
        const elements = parseJob(Buffer.concat(chunks).toString('utf8'));
        const job = { contentType: req.headers['content-type'], elements, files: [] };
        await mkdir(outDir, { recursive: true });
        for (const el of elements) {
          if (el.tag !== 'bitimage') continue;
          const file = path.join(outDir, `bon-${String(++seq).padStart(3, '0')}.png`);
          await writeFile(file, monoToPng(+el.attrs.width, +el.attrs.height, Buffer.from(el.text, 'base64')));
          job.files.push(file);
        }
        jobs.push(job);
        log(`Auftrag: ${elements.map((e) => e.tag).join(', ')}${job.files.length ? ' -> ' + job.files.join(', ') : ''}`);
      } catch (e) {
        success = false;
        log(`Fehlerhafter Auftrag: ${e.message}`);
      }
      const result = `<root><success>${success}</success><code>${success ? 0 : 1100}</code><status>23860000000000000000</status></root>`;
      res.writeHead(200, { ...CORS, 'content-type': 'text/xml; charset=utf-8' });
      res.end(`<StarWebPrint xmlns="http://www.star-m.jp" xmlns:i="http://www.w3.org/2001/XMLSchema-instance"><Response>${result.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</Response></StarWebPrint>`);
    });
  });
  return new Promise((resolve) => server.listen(port, () => resolve({ server, jobs })));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.argv[2] ?? 8091);
  const outDir = process.argv[3] ?? 'bons';
  await startMockPrinter({ port, outDir });
  console.log(`Drucker-Attrappe läuft auf http://localhost:${port}/StarWebPRNT/SendMessage – Bons landen in "${outDir}/"`);
}
