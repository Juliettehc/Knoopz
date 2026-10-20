// E-mails via Resend. Zolang RESEND_API_KEY of MAIL_FROM niet is ingesteld, worden er geen mails verstuurd
// (de bestelling werkt dan gewoon; jullie zien hem in het beheer).
import type { Env } from './env';

export type Order = {
  id: string;
  number: string;
  token: string;
  status: string;
  lang: 'nl' | 'en';
  email: string;
  first_name: string;
  last_name: string;
  street: string;
  postal_code: string;
  city: string;
  country: 'NL' | 'BE';
  subtotal_cents: number;
  discount_cents: number;
  discount_code: string | null;
  shipping_cents: number;
  total_cents: number;
  vat_mode: 'incl21' | 'kor';
  vat_cents: number;
  payment_method: string | null;
  tracking_url: string | null;
  needs_attention: string | null;
  items: { code: string; name: string; size: string | null; price_cents: number }[];
};

export const mailEnabled = (env: Env) => !!(env.RESEND_API_KEY && env.MAIL_FROM);

export async function sendMail(env: Env, to: string | string[], subject: string, html: string): Promise<boolean> {
  if (!mailEnabled(env)) return false;
  const res = await fetch(`${env.RESEND_API_BASE || 'https://api.resend.com'}/emails`, {
    method: 'POST',
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from: env.MAIL_FROM, to: Array.isArray(to) ? to : [to], subject, html, ...(env.MAIL_REPLY_TO ? { reply_to: env.MAIL_REPLY_TO } : {}) }),
  });
  if (!res.ok) console.error('Mail mislukt', res.status, await res.text());
  return res.ok;
}

const esc = (v: unknown) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const money = (lang: string, cents: number) =>
  new Intl.NumberFormat(lang === 'en' ? 'en-IE' : 'nl-NL', { style: 'currency', currency: 'EUR' }).format(cents / 100);

const T = {
  nl: {
    thanks: (n: string) => `Bedankt voor je bestelling, ${n}!`,
    intro: 'We hebben je betaling ontvangen. We pakken je bestelling met zorg in en laten het je weten zodra hij onderweg is.',
    order: 'Bestelling',
    subtotal: 'Subtotaal',
    discount: 'Korting',
    shipping: 'Verzending',
    free: 'Gratis',
    total: 'Totaal',
    vat: (v: string) => `Inclusief ${v} btw`,
    kor: 'Geen btw berekend (kleineondernemersregeling)',
    address: 'Bezorgadres',
    unique: 'Uniek stuk',
    shippedTitle: (n: string) => `Je bestelling is onderweg, ${n}!`,
    shippedIntro: 'Je KNOOPZ-bestelling is verzonden.',
    track: 'Volg je pakket',
    subjectConfirm: (nr: string) => `Bevestiging van je bestelling ${nr} · KNOOPZ`,
    subjectShipped: (nr: string) => `Je bestelling ${nr} is verzonden · KNOOPZ`,
    footer: 'Vragen? Beantwoord gewoon deze e-mail.',
    countries: { NL: 'Nederland', BE: 'België' },
  },
  en: {
    thanks: (n: string) => `Thank you for your order, ${n}!`,
    intro: "We've received your payment. We'll pack your order with care and let you know as soon as it's on its way.",
    order: 'Order',
    subtotal: 'Subtotal',
    discount: 'Discount',
    shipping: 'Shipping',
    free: 'Free',
    total: 'Total',
    vat: (v: string) => `Including ${v} VAT`,
    kor: 'No VAT charged (Dutch small business scheme)',
    address: 'Delivery address',
    unique: 'One of a kind',
    shippedTitle: (n: string) => `Your order is on its way, ${n}!`,
    shippedIntro: 'Your KNOOPZ order has been shipped.',
    track: 'Track your parcel',
    subjectConfirm: (nr: string) => `Your order ${nr} is confirmed · KNOOPZ`,
    subjectShipped: (nr: string) => `Your order ${nr} has shipped · KNOOPZ`,
    footer: 'Questions? Simply reply to this email.',
    countries: { NL: 'The Netherlands', BE: 'Belgium' },
  },
};

const layout = (body: string) => `<!doctype html><html><body style="margin:0;background:#F6F3EE;font-family:Helvetica,Arial,sans-serif;color:#141414">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F6F3EE"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #E2DCD2">
<tr><td style="padding:28px 32px;border-bottom:1px solid #E2DCD2;font-family:Georgia,serif;font-size:26px;letter-spacing:2px;color:#A61F2E">KNOOPZ</td></tr>
<tr><td style="padding:28px 32px;font-size:15px;line-height:1.6">${body}</td></tr>
</table></td></tr></table></body></html>`;

function summary(o: Order) {
  const t = T[o.lang];
  const row = (l: string, r: string, bold = false) =>
    `<tr><td style="padding:6px 0;${bold ? 'font-weight:bold' : ''}">${l}</td><td align="right" style="padding:6px 0;${bold ? 'font-weight:bold' : ''}">${r}</td></tr>`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;border-top:1px solid #E2DCD2;margin-top:16px">
${o.items.map((i) => row(`${esc(i.name)}<br><span style="color:#625D57;font-size:12px">${esc(i.code)} · ${t.unique}</span>`, money(o.lang, i.price_cents))).join('')}
<tr><td colspan="2" style="border-top:1px solid #E2DCD2;padding-top:6px"></td></tr>
${row(t.subtotal, money(o.lang, o.subtotal_cents))}
${o.discount_cents ? row(`${t.discount}${o.discount_code ? ` (${esc(o.discount_code)})` : ''}`, `− ${money(o.lang, o.discount_cents)}`) : ''}
${row(t.shipping, o.shipping_cents ? money(o.lang, o.shipping_cents) : t.free)}
${row(t.total, money(o.lang, o.total_cents), true)}
</table>
<p style="color:#625D57;font-size:12px;margin:4px 0 0">${o.vat_mode === 'kor' ? t.kor : t.vat(money(o.lang, o.vat_cents))}</p>`;
}

const address = (o: Order) =>
  `${esc(o.first_name)} ${esc(o.last_name)}<br>${esc(o.street)}<br>${esc(o.postal_code)} ${esc(o.city)}<br>${T[o.lang].countries[o.country]}`;

export function confirmationMail(o: Order) {
  const t = T[o.lang];
  return {
    subject: t.subjectConfirm(o.number),
    html: layout(`<h1 style="font-family:Georgia,serif;font-weight:normal;font-size:24px;margin:0 0 12px">${esc(t.thanks(o.first_name))}</h1>
<p style="margin:0 0 8px">${t.intro}</p>
<p style="margin:16px 0 0;font-size:13px;color:#625D57">${t.order} <strong style="color:#141414">${esc(o.number)}</strong></p>
${summary(o)}
<p style="margin:24px 0 4px;font-size:13px;color:#625D57">${t.address}</p><p style="margin:0">${address(o)}</p>
<p style="margin:28px 0 0;font-size:13px;color:#625D57">${t.footer}</p>`),
  };
}

export function shippedMail(o: Order) {
  const t = T[o.lang];
  const track = o.tracking_url && /^https?:\/\//i.test(o.tracking_url)
    ? `<p style="margin:20px 0"><a href="${esc(o.tracking_url)}" style="display:inline-block;background:#141414;color:#F6F3EE;padding:14px 24px;text-decoration:none;font-size:12px;letter-spacing:2px;text-transform:uppercase">${t.track}</a></p>`
    : o.tracking_url ? `<p>${esc(o.tracking_url)}</p>` : '';
  return {
    subject: t.subjectShipped(o.number),
    html: layout(`<h1 style="font-family:Georgia,serif;font-weight:normal;font-size:24px;margin:0 0 12px">${esc(t.shippedTitle(o.first_name))}</h1>
<p style="margin:0">${t.shippedIntro} (${esc(o.number)})</p>${track}
<p style="margin:24px 0 4px;font-size:13px;color:#625D57">${t.address}</p><p style="margin:0">${address(o)}</p>
<p style="margin:28px 0 0;font-size:13px;color:#625D57">${t.footer}</p>`),
  };
}

export function adminMail(o: Order, adminUrl: string) {
  const items = o.items.map((i) => `${esc(i.code)} · ${esc(i.name)} · ${money('nl', i.price_cents)}`).join('<br>');
  return {
    subject: `${o.needs_attention ? 'LET OP: ' : ''}Nieuwe bestelling ${o.number} · ${money('nl', o.total_cents)}`,
    html: layout(`<h1 style="font-family:Georgia,serif;font-weight:normal;font-size:22px;margin:0 0 12px">Nieuwe bestelling ${esc(o.number)}</h1>
${o.needs_attention ? `<p style="background:#A61F2E;color:#fff;padding:12px">${esc(o.needs_attention)}</p>` : ''}
<p style="margin:0 0 12px">${items}</p>
<p style="margin:0 0 12px">Totaal: <strong>${money('nl', o.total_cents)}</strong>${o.discount_code ? ` (code ${esc(o.discount_code)})` : ''}</p>
<p style="margin:0 0 12px">${address(o)}<br>${esc(o.email)}</p>
<p style="margin:20px 0 0"><a href="${esc(adminUrl)}" style="color:#A61F2E">Bekijk in het beheer</a></p>`),
  };
}
