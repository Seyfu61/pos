// Update der Kasse erzwingen: Offline-Speicher leeren, Service Worker neu holen, Seite neu laden.

export async function forceUpdate() {
  if (!navigator.onLine) throw new Error('Keine Internetverbindung – das Update kann gerade nicht geladen werden.');
  const reg = await navigator.serviceWorker?.getRegistration?.();
  await reg?.update?.().catch(() => {});
  if (globalThis.caches) for (const key of await caches.keys()) await caches.delete(key);
  location.reload();
}
