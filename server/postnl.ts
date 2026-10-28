// PostNL: barcode + verzendlabel (PDF) aanmaken en de bezorgstatus opvragen.
// De API-sleutel staat alleen in Cloudflare (POSTNL_API_KEY). Met POSTNL_SANDBOX=1 praat je met de testomgeving.
import type { Env } from './env';

const base = (env: Env) => env.POSTNL_API_BASE || (env.POSTNL_SANDBOX === '1' ? 'https://api-sandbox.postnl.nl' : 'https://api.postnl.nl');

export const postnlEnabled = (env: Env) => !!(env.POSTNL_API_KEY && env.POSTNL_CUSTOMER_CODE && env.POSTNL_CUSTOMER_NUMBER);

async function call(env: Env, path: string, init: RequestInit = {}) {
  const res = await fetch(`${base(env)}${path}`, {
    ...init,
    headers: { apikey: env.POSTNL_API_KEY!, accept: 'application/json', 'content-type': 'application/json' },
  });
  const body: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = body?.Errors?.[0] ?? body?.fault ?? body?.[0] ?? body;
    throw new Error(`PostNL ${res.status}: ${err?.Description || err?.ErrorMsg || err?.faultstring || err?.message || JSON.stringify(body).slice(0, 300)}`);
  }
  return body;
}

// "Kerkstraat 12 A" -> straat "Kerkstraat", huisnummer "12", toevoeging "A"
export function splitStreet(s: string) {
  const m = s.trim().match(/^(.+?)\s+(\d+)\s*[-/\s]?\s*([A-Za-z0-9]{0,6})$/);
  if (!m) return null;
  return { street: m[1].trim(), houseNr: m[2], ext: m[3] || '' };
}

export const trackingUrl = (barcode: string, country: string, postal: string) =>
  `https://jouw.postnl.nl/track-and-trace/${encodeURIComponent(barcode)}-${country}-${postal.replace(/\s+/g, '').toUpperCase()}`;

const stamp = () => {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Amsterdam' }));
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

export type Sender = { company: string | null; street: string | null; house_nr: string | null; house_nr_ext: string | null; postal_code: string | null; city: string | null; weight_grams: number };
export type Recipient = { first_name: string; last_name: string; street: string; postal_code: string; city: string; country: string; email: string; number: string };

export async function createLabel(env: Env, sender: Sender, to: Recipient) {
  const addr = splitStreet(to.street);
  if (!addr) throw new Error(`Huisnummer niet gevonden in "${to.street}". Pas het adres aan in Supabase of maak het label handmatig.`);
  if (!sender.street || !sender.house_nr || !sender.postal_code || !sender.city) throw new Error('Vul eerst het afzenderadres in bij Instellingen.');

  const { Barcode: barcode } = await call(
    env,
    `/shipment/v1_1/barcode?CustomerCode=${encodeURIComponent(env.POSTNL_CUSTOMER_CODE!)}&CustomerNumber=${encodeURIComponent(env.POSTNL_CUSTOMER_NUMBER!)}&Type=3S&Serie=000000000-999999999`,
  );
  if (!barcode) throw new Error('PostNL gaf geen barcode terug');

  const body = await call(env, '/shipment/v2_2/label?confirm=true', {
    method: 'POST',
    body: JSON.stringify({
      Customer: {
        Address: {
          AddressType: '02',
          CompanyName: sender.company || 'KNOOPZ',
          Street: sender.street,
          HouseNr: sender.house_nr,
          HouseNrExt: sender.house_nr_ext || undefined,
          Zipcode: sender.postal_code.replace(/\s+/g, '').toUpperCase(),
          City: sender.city,
          Countrycode: 'NL',
        },
        CustomerCode: env.POSTNL_CUSTOMER_CODE,
        CustomerNumber: env.POSTNL_CUSTOMER_NUMBER,
      },
      Message: { MessageID: to.number, MessageTimeStamp: stamp(), Printertype: 'GraphicFile|PDF' },
      Shipments: [
        {
          Addresses: [
            {
              AddressType: '01',
              FirstName: to.first_name,
              Name: to.last_name,
              Street: addr.street,
              HouseNr: addr.houseNr,
              HouseNrExt: addr.ext || undefined,
              Zipcode: to.postal_code.replace(/\s+/g, '').toUpperCase(),
              City: to.city,
              Countrycode: to.country,
            },
          ],
          Barcode: barcode,
          Contacts: [{ ContactType: '01', Email: to.email }],
          Dimension: { Weight: String(sender.weight_grams || 1000) },
          Reference: to.number,
          ProductCodeDelivery: to.country === 'BE' ? '4946' : '3085',
        },
      ],
    }),
  });
  const shipment = body?.ResponseShipments?.[0];
  const pdf: string | undefined = shipment?.Labels?.[0]?.Content;
  if (!pdf) throw new Error('PostNL gaf geen label terug');
  return { barcode: (shipment.Barcode as string) || barcode, pdf, url: trackingUrl(barcode, to.country, to.postal_code) };
}

// Bezorgd? PostNL fase 4 = "Afgeleverd" (statuscode 11).
export async function deliveryStatus(env: Env, barcode: string) {
  const body = await call(env, `/shipment/v2/status/barcode/${encodeURIComponent(barcode)}?detail=false&language=NL`);
  const s = body?.CurrentStatus?.Shipment;
  const status = (Array.isArray(s) ? s[0] : s)?.Status ?? {};
  const delivered = String(status.PhaseCode) === '4' || String(status.StatusCode) === '11';
  // TimeStamp komt als "28-10-2026 14:01:00" (Nederlandse tijd)
  const m = String(status.TimeStamp ?? '').match(/^(\d{2})-(\d{2})-(\d{4}) (\d{2}):(\d{2})/);
  const at = m ? new Date(`${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:00+01:00`).toISOString() : null;
  return { delivered, at, description: (status.StatusDescription as string) || (status.PhaseDescription as string) || '' };
}
