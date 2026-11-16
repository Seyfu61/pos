// Voreinstellungen – alles lässt sich in der App unter "Einstellungen" ändern.

export const DEFAULT_SETTINGS = {
  shop: {
    name: 'Pizza Haus & mehr',
    line1: 'Steintorstraße 1b',
    line2: '37124 Rosdorf',
    phone: '05509 999440',
    taxId: '', // Steuernummer oder USt-IdNr., erscheint auf dem Bon
    footer: 'Vielen Dank für Ihre Bestellung!\nGuten Appetit!',
  },
  printer: {
    // none    – nur Vorschau am Bildschirm
    // webprnt – Star WebPRNT direkt an die IP-Adresse des Druckers
    // browser – App "Star webPRNT Browser" (Bluetooth / USB / LAN)
    // system  – Druckdialog des iPads (AirPrint)
    driver: 'none',
    host: '',
    https: false,
    paper: 80, // Papierbreite in mm (mC-Print3: 80, mC-Print2: 58)
    drawer: false, // Kassenschublade bei Barzahlung öffnen
    printCustomer: true,
    customerCopies: 2, // Anzahl Kundenbons je Bestellung
    printKitchen: true,
    mapsQr: true, // Google-Maps-QR-Code mit der Lieferadresse auf dem Kundenbon
  },
  ui: {
    numpad: true, // Nummernfeld an der Kasse einblenden
  },
  order: {
    defaultType: 'delivery',
    deliveryFees: [180, 250, 350], // Schnellauswahl in Cent
    deliveryTax: 7,
  },
};

export function mergeSettings(saved) {
  const out = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  for (const section of Object.keys(out)) Object.assign(out[section], saved?.[section] ?? {});
  // Stände aus früheren Versionen angleichen: alte Vorgabe der Lieferkosten, entfallene Bestellart "Im Haus".
  if (out.order.deliveryFees.join() === '0,100,200,300') out.order.deliveryFees = [...DEFAULT_SETTINGS.order.deliveryFees];
  if (!['delivery', 'pickup'].includes(out.order.defaultType)) out.order.defaultType = 'delivery';
  return out;
}
