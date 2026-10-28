// E-mails van KNOOPZ: standaardteksten en de opmaak in de huisstijl van de website.
// Wordt gebruikt door de server (echte mails) én door het beheer (live voorbeeld bij "E-mails").
// Bewust gewoon JavaScript zonder afhankelijkheden, zodat het overal draait.
//
// Teksten zijn aan te passen in het beheer. Lege velden vallen terug op de standaardtekst hieronder.
// In alle teksten kun je deze woorden tussen accolades gebruiken: zie PLACEHOLDERS.
// Opmaak in de tekst: **woord** = dikgedrukt, witregel = nieuwe alinea, enter = nieuwe regel.

export const PLACEHOLDERS = [
  ['{voornaam}', 'Voornaam van de klant'],
  ['{achternaam}', 'Achternaam van de klant'],
  ['{nummer}', 'Bestelnummer, bijv. KNZ-1001'],
  ['{totaal}', 'Totaalbedrag'],
  ['{barcode}', 'PostNL-barcode (alleen bij "onderweg")'],
];

// Welke mails er zijn en welke velden je per mail kunt aanpassen
export const TEMPLATES = [
  { key: 'confirmation', title: 'Betaling ontvangen', to: 'Klant', when: 'Direct nadat de klant heeft betaald', fields: ['subject', 'heading', 'body'] },
  { key: 'shipped', title: 'Bestelling onderweg', to: 'Klant', when: 'Zodra jullie in het beheer op "Label aanmaken" klikken', fields: ['subject', 'heading', 'body', 'button'] },
  { key: 'admin_new', title: 'Nieuwe bestelling', to: 'Jullie (beheerders)', when: 'Direct nadat er een bestelling is betaald', fields: ['subject', 'heading', 'body', 'button'], nlOnly: true },
  { key: 'footer', title: 'Afsluiting (alle klantmails)', to: 'Klant', when: 'Onderaan elke klantmail', fields: ['body'] },
];

export const FIELD_LABELS = { subject: 'Onderwerp', heading: 'Kop', body: 'Tekst', button: 'Tekst op de knop' };

export const DEFAULTS = {
  confirmation: {
    nl: {
      subject: 'We hebben je betaling ontvangen · {nummer}',
      heading: 'Dankjewel, {voornaam}!',
      body: 'Je betaling voor bestelling **{nummer}** is goed ontvangen.\n\nWe pakken je bestelling met zorg in. Zodra hij onderweg is, krijg je een mail met de track & trace van PostNL.',
    },
    en: {
      subject: "We've received your payment · {nummer}",
      heading: 'Thank you, {voornaam}!',
      body: "We've received your payment for order **{nummer}**.\n\nWe'll pack your order with care. As soon as it's on its way, you'll get an email with the PostNL track & trace.",
    },
  },
  shipped: {
    nl: {
      subject: 'Je bestelling {nummer} is onderweg',
      heading: 'Je bestelling is onderweg, {voornaam}!',
      body: 'Goed nieuws: je KNOOPZ-bestelling is ingepakt en gaat met PostNL naar je toe. Met de knop hieronder volg je je pakket.',
      button: 'Volg je pakket',
    },
    en: {
      subject: 'Your order {nummer} is on its way',
      heading: 'Your order is on its way, {voornaam}!',
      body: 'Good news: your KNOOPZ order has been packed and is heading your way with PostNL. Use the button below to track your parcel.',
      button: 'Track your parcel',
    },
  },
  admin_new: {
    nl: {
      subject: 'Nieuwe bestelling {nummer} · {totaal}',
      heading: 'Er is een bestelling geplaatst',
      body: '**{voornaam} {achternaam}** heeft zojuist bestelling {nummer} geplaatst en betaald.',
      button: 'Bekijk in het beheer',
    },
  },
  footer: {
    nl: { body: 'Vragen over je bestelling? Beantwoord gewoon deze e-mail, dan helpen we je graag.\n\nLiefs,\nKNOOPZ' },
    en: { body: "Questions about your order? Simply reply to this email and we'll be happy to help.\n\nWith love,\nKNOOPZ" },
  },
};

const C = { bg: '#F6F3EE', ink: '#141414', muted: '#625D57', accent: '#A61F2E', line: '#E2DCD2', white: '#FFFFFF' };
const HEAD = "'Bodoni Moda',Georgia,'Times New Roman',serif";
const BODY = "Jost,'Helvetica Neue',Helvetica,Arial,sans-serif";

const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const money = (lang, cents) =>
  new Intl.NumberFormat(lang === 'en' ? 'en-IE' : 'nl-NL', { style: 'currency', currency: 'EUR' }).format((cents || 0) / 100);

const L = {
  nl: {
    order: 'Bestelling', subtotal: 'Subtotaal', discount: 'Korting', shipping: 'Verzending', free: 'Gratis', total: 'Totaal',
    vat: (v) => `Inclusief ${v} btw`, kor: 'Geen btw berekend (kleineondernemersregeling)', address: 'Bezorgadres',
    unique: 'Uniek stuk', barcode: 'Barcode PostNL', items: 'In je pakket', countries: { NL: 'Nederland', BE: 'België' },
  },
  en: {
    order: 'Order', subtotal: 'Subtotal', discount: 'Discount', shipping: 'Shipping', free: 'Free', total: 'Total',
    vat: (v) => `Including ${v} VAT`, kor: 'No VAT charged (Dutch small business scheme)', address: 'Delivery address',
    unique: 'One of a kind', barcode: 'PostNL barcode', items: 'In your parcel', countries: { NL: 'The Netherlands', BE: 'Belgium' },
  },
};

// Tekst kiezen: eigen tekst uit het beheer, anders de standaard (Engels valt terug op Nederlands)
export function pick(overrides, key, lang, field) {
  const own = overrides?.[key]?.[lang]?.[field];
  if (typeof own === 'string' && own.trim()) return own;
  return DEFAULTS[key]?.[lang]?.[field] ?? DEFAULTS[key]?.nl?.[field] ?? '';
}

const vars = (o) => ({
  voornaam: o.first_name, achternaam: o.last_name, nummer: o.number,
  totaal: money(o.lang, o.total_cents), barcode: o.postnl_barcode || '',
});

// Platte tekst (voor het onderwerp)
const fill = (s, v) => s.replace(/\{(\w+)\}/g, (m, k) => (k in v ? String(v[k] ?? '') : m));

// Tekst naar veilige HTML: eerst escapen, dan {woorden}, **vet**, alinea's en regels
function richText(s, v, pStyle) {
  return fill(esc(s), Object.fromEntries(Object.entries(v).map(([k, x]) => [k, esc(x)])))
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p style="${pStyle}">${p.replace(/\*\*(.+?)\*\*/g, `<strong style="font-weight:600;color:${C.ink}">$1</strong>`).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

const P = `margin:0 0 16px;font-family:${BODY};font-size:16px;line-height:1.7;color:${C.ink}`;
const SMALL = `margin:0 0 6px;font-family:${BODY};font-size:12px;font-weight:500;letter-spacing:2px;text-transform:uppercase;color:${C.muted}`;

const button = (href, label) => `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 28px"><tr>
<td style="background:${C.accent}"><a href="${esc(href)}" style="display:inline-block;padding:18px 32px;font-family:${BODY};font-size:12px;font-weight:500;letter-spacing:2px;text-transform:uppercase;color:${C.white};text-decoration:none">${esc(label)}</a></td>
</tr></table>`;

function summary(o, withPrices = true) {
  const t = L[o.lang] || L.nl;
  const td = `padding:10px 0;font-family:${BODY};font-size:14px;line-height:1.5;color:${C.ink};border-bottom:1px solid ${C.line}`;
  const row = (l, r, bold = false) =>
    `<tr><td style="${td}${bold ? ';font-weight:600' : ''}">${l}</td><td align="right" style="${td};white-space:nowrap${bold ? ';font-weight:600' : ''}">${r}</td></tr>`;
  const items = (o.items || [])
    .map((i) => row(`${esc(i.name)}<br><span style="font-size:12px;color:${C.muted}">${esc(i.code)} · ${t.unique}</span>`, withPrices ? money(o.lang, i.price_cents) : ''))
    .join('');
  if (!withPrices) return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid ${C.line}">${items}</table>`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid ${C.line}">
${items}
${row(t.subtotal, money(o.lang, o.subtotal_cents))}
${o.discount_cents ? row(`${t.discount}${o.discount_code ? ` (${esc(o.discount_code)})` : ''}`, `− ${money(o.lang, o.discount_cents)}`) : ''}
${row(t.shipping, o.shipping_cents ? money(o.lang, o.shipping_cents) : t.free)}
${row(t.total, money(o.lang, o.total_cents), true)}
</table>
<p style="margin:8px 0 0;font-family:${BODY};font-size:12px;color:${C.muted}">${o.vat_mode === 'kor' ? t.kor : t.vat(money(o.lang, o.vat_cents))}</p>`;
}

const address = (o) => {
  const t = L[o.lang] || L.nl;
  return `<p style="${SMALL};margin-top:32px">${t.address}</p>
<p style="margin:0;font-family:${BODY};font-size:15px;line-height:1.6;color:${C.ink}">${esc(o.first_name)} ${esc(o.last_name)}<br>${esc(o.street)}<br>${esc(o.postal_code)} ${esc(o.city)}<br>${t.countries[o.country] ?? esc(o.country)}</p>`;
};

function layout({ origin, lang, preheader, body, footer }) {
  const home = `${origin}${lang === 'en' ? '/en/' : '/'}`;
  return `<!doctype html>
<html lang="${lang === 'en' ? 'en' : 'nl'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light">
<link href="https://fonts.googleapis.com/css2?family=Bodoni+Moda:wght@500&family=Jost:wght@400;500;600&display=swap" rel="stylesheet">
<title>KNOOPZ</title></head>
<body style="margin:0;padding:0;background:${C.bg};-webkit-font-smoothing:antialiased">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.bg}"><tr><td align="center" style="padding:40px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px">
<tr><td align="center" style="padding:0 0 32px"><a href="${esc(home)}" style="text-decoration:none"><img src="${esc(origin)}/knoopz-logo.png" width="180" alt="KNOOPZ" style="display:block;width:180px;max-width:60%;height:auto;border:0"></a></td></tr>
<tr><td style="background:${C.white};border:1px solid ${C.line};padding:48px 44px" class="card">${body}</td></tr>
${footer ? `<tr><td style="padding:32px 44px 0">${footer}</td></tr>` : ''}
<tr><td align="center" style="padding:32px 16px 0;font-family:${BODY};font-size:12px;letter-spacing:2px;text-transform:uppercase;color:${C.muted}">
<a href="${esc(home)}" style="color:${C.muted};text-decoration:none">${esc(origin.replace(/^https?:\/\//, ''))}</a></td></tr>
</table></td></tr></table></body></html>`;
}

const heading = (s) =>
  `<h1 style="margin:0 0 20px;font-family:${HEAD};font-weight:500;font-size:34px;line-height:1.15;color:${C.ink}">${s}</h1>`;

/**
 * Maakt een complete mail.
 * @param {'confirmation'|'shipped'|'admin_new'} key
 * @param {any} o  bestelling (zoals uit order_by_id), met items[]
 * @param {any} overrides  eigen teksten uit het beheer: { [key]: { nl: {...}, en: {...} } }
 * @param {{ origin: string, adminUrl?: string }} opts
 * @returns {{ subject: string, html: string }}
 */
export function renderEmail(key, o, overrides, opts) {
  const lang = key === 'admin_new' ? 'nl' : o.lang === 'en' ? 'en' : 'nl';
  const t = L[lang];
  const v = vars(o);
  const get = (f) => pick(overrides, key, lang, f);
  const subject = fill(get('subject'), v);
  const footer = key === 'admin_new' ? '' : richText(pick(overrides, 'footer', lang, 'body'), v, `margin:0 0 12px;font-family:${BODY};font-size:14px;line-height:1.7;color:${C.muted}`);
  const intro = heading(richText(get('heading'), v, 'margin:0').replace(/^<p style="margin:0">|<\/p>$/g, '')) + richText(get('body'), v, P);
  const eyebrow = `<p style="${SMALL}">${t.order} ${esc(o.number)}</p>`;
  let body = '';

  if (key === 'confirmation') {
    body = eyebrow + intro + `<div style="height:12px"></div>` + summary(o) + address(o);
  } else if (key === 'shipped') {
    const track = o.tracking_url && /^https?:\/\//i.test(o.tracking_url) ? button(o.tracking_url, get('button')) : '';
    const code = o.postnl_barcode
      ? `<p style="${SMALL}">${t.barcode}</p><p style="margin:0 0 28px;font-family:${BODY};font-size:15px;letter-spacing:1px;color:${C.ink}">${esc(o.postnl_barcode)}</p>`
      : '';
    body = eyebrow + intro + track + code + `<p style="${SMALL}">${t.items}</p>` + summary(o, false) + address(o);
  } else {
    const att = o.needs_attention
      ? `<p style="margin:0 0 20px;padding:14px 16px;background:${C.accent};color:${C.white};font-family:${BODY};font-size:14px;line-height:1.5">${esc(o.needs_attention)}</p>`
      : '';
    body = eyebrow + att + intro + (opts.adminUrl ? button(opts.adminUrl, get('button')) : '') + summary(o) + address(o) +
      `<p style="margin:16px 0 0;font-family:${BODY};font-size:15px"><a href="mailto:${esc(o.email)}" style="color:${C.accent}">${esc(o.email)}</a></p>`;
  }

  return {
    subject: (o.needs_attention && key === 'admin_new' ? 'LET OP: ' : '') + subject,
    html: layout({ origin: opts.origin, lang, preheader: fill(get('heading'), v).replace(/\*\*/g, ''), body, footer }),
  };
}

// Voorbeeldbestelling voor het voorbeeld in het beheer
export const SAMPLE_ORDER = {
  id: '00000000-0000-0000-0000-000000000000',
  number: 'KNZ-1042',
  lang: 'nl',
  email: 'sanne@voorbeeld.nl',
  first_name: 'Sanne',
  last_name: 'de Vries',
  street: 'Kerkstraat 12',
  postal_code: '1017 GC',
  city: 'Amsterdam',
  country: 'NL',
  subtotal_cents: 8900,
  discount_cents: 0,
  discount_code: null,
  shipping_cents: 495,
  total_cents: 9395,
  vat_mode: 'incl21',
  vat_cents: 1631,
  needs_attention: null,
  postnl_barcode: '3SKNPZ0012345678',
  tracking_url: 'https://jouw.postnl.nl/track-and-trace/3SKNPZ0012345678-NL-1017GC',
  items: [
    { code: 'K-014', name: 'Gehaakte tas Bordeaux', size: null, price_cents: 5900 },
    { code: 'K-021', name: 'Haarclip Crème', size: null, price_cents: 3000 },
  ],
};
