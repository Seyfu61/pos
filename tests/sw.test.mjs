import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function walk(dir) {
  const out = [];
  for (const e of await readdir(path.join(root, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) out.push(...(await walk(rel)));
    else out.push(rel);
  }
  return out;
}

test('Offline-Liste im Service Worker ist vollständig', async () => {
  const sw = await readFile(path.join(root, 'sw.js'), 'utf8');
  const listed = [...sw.matchAll(/^\s+'([^']+)',$/gm)].map((m) => m[1]).filter((f) => f !== './');
  for (const f of listed) assert.ok(existsSync(path.join(root, f)), `in sw.js gelistet, aber nicht vorhanden: ${f}`);
  const needed = [...(await walk('js')), ...(await walk('css')), 'vendor/preact-htm.js', 'index.html', 'manifest.webmanifest'];
  for (const f of needed) assert.ok(listed.includes(f), `fehlt in der Offline-Liste von sw.js: ${f}`);
});

test('Versionsnummer der App passt zum Offline-Speicher', async () => {
  const sw = await readFile(path.join(root, 'sw.js'), 'utf8');
  const { APP_VERSION } = await import('../js/version.js');
  assert.ok(Number.isInteger(APP_VERSION));
  assert.equal(/const CACHE = '([^']+)'/.exec(sw)?.[1], `kasse-v${APP_VERSION}`, 'bei jeder Änderung beide hochzählen');
});

test('Service Worker fragt immer beim Server nach (kein veralteter Browser-Zwischenspeicher)', async () => {
  const sw = await readFile(path.join(root, 'sw.js'), 'utf8');
  assert.match(sw, /cache: 'no-cache'/);
  assert.match(sw, /cache: 'reload'/);
  const main = await readFile(path.join(root, 'js/main.js'), 'utf8');
  assert.match(main, /updateViaCache: 'none'/);
});

test('Jeder Import zeigt auf eine vorhandene Datei', async () => {
  for (const file of await walk('js')) {
    const src = await readFile(path.join(root, file), 'utf8');
    for (const m of src.matchAll(/from '(\.[^']+)'/g)) {
      const target = path.resolve(root, path.dirname(file), m[1]);
      assert.ok(existsSync(target), `${file} importiert ${m[1]}`);
    }
  }
});
