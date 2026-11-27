// Prüft im echten Browser, dass die Kasse ein Update auf dem Server bemerkt:
//
//   node tests/update.e2e.mjs
//
// Startet einen Webserver auf einer Kopie des Projekts, lädt die Kasse, legt dann eine neue Version
// (geänderte sw.js) ab und erwartet den Hinweis "neue Version" sowie das Neuladen.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const { chromium } = createRequire(import.meta.url)('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const copy = await mkdtemp(path.join(tmpdir(), 'kasse-update-'));
await cp(root, copy, { recursive: true, filter: (src) => !/[/\\](\.git|node_modules|bons)([/\\]|$)/.test(src) });

const PORT = 8095;
const APP = `http://localhost:${PORT}/`;
const server = spawn(process.execPath, [path.join(copy, 'tools/serve.mjs'), String(PORT)], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 500));

const swFile = path.join(copy, 'sw.js');
const publish = async (n) => writeFile(swFile, (await readFile(swFile, 'utf8')) + `\n// Testversion ${n}\n`);

const browser = await chromium.launch();
const problems = [];
try {
  const page = await (await browser.newContext({ viewport: { width: 1180, height: 820 } })).newPage();
  page.on('pageerror', (e) => problems.push(e.message));
  await page.goto(APP);
  await page.locator('.product').first().waitFor();
  // Erste Installation: Service Worker übernimmt die Seite, das ist kein Update
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await page.waitForTimeout(300);
  assert.equal(await page.locator('.update-banner').count(), 0, 'kein Hinweis bei der ersten Installation');

  // Version in den Einstellungen sichtbar
  await page.locator('.rail-btn', { hasText: 'Einstellungen' }).click();
  await page.locator('.segmented button', { hasText: 'Daten' }).click();
  const { APP_VERSION } = await import('../js/version.js');
  assert.match(await page.locator('.version-row').innerText(), new RegExp(`Version ${APP_VERSION}`));
  await page.locator('.rail-btn', { hasText: 'Kasse' }).click();

  // Etwas auf dem Bon -> kein automatisches Neuladen, sondern Hinweis
  await page.locator('.cat', { hasText: 'Getränke' }).click();
  await page.locator('.product', { hasText: 'Wasser still' }).click();
  await publish(1);
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); // App wieder im Vordergrund
  await page.locator('.update-banner').waitFor({ timeout: 15000 });
  assert.match(await page.locator('.update-banner').innerText(), /neue Version/);
  assert.equal(await page.locator('.line').count(), 1, 'Bon bleibt erhalten');
  await Promise.all([page.waitForEvent('load'), page.getByRole('button', { name: 'Jetzt neu laden' }).click()]);
  await page.locator('.product').first().waitFor();
  assert.equal(await page.locator('.update-banner').count(), 0);
  assert.equal(await page.locator('.line').count(), 1, 'Bon nach dem Neuladen noch da');

  // Leerer Bon: beim Zurückkehren in die App wird das Update gleich übernommen
  page.on('dialog', (d) => d.accept());
  await page.locator('.ticket-actions .btn').first().click();
  assert.equal(await page.locator('.line').count(), 0);
  await publish(2);
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.locator('.update-banner').waitFor({ timeout: 15000 });
  await Promise.all([page.waitForEvent('load'), page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))]);
  await page.locator('.product').first().waitFor();
  assert.equal(await page.locator('.update-banner').count(), 0);

  // "Nach Update suchen und neu laden" leert den Offline-Speicher und lädt neu
  await page.locator('.rail-btn', { hasText: 'Einstellungen' }).click();
  await page.locator('.segmented button', { hasText: 'Daten' }).click();
  await Promise.all([page.waitForEvent('load'), page.getByRole('button', { name: /Nach Update suchen/ }).click()]);
  await page.locator('.product').first().waitFor();

  assert.deepEqual(problems, []);
  console.log('OK – Update wird erkannt und übernommen');
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  await browser.close();
  server.kill();
  await rm(copy, { recursive: true, force: true });
}
