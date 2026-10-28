// E-mails via Resend. Zolang RESEND_API_KEY of MAIL_FROM niet is ingesteld, worden er geen mails verstuurd
// (de bestelling werkt dan gewoon; jullie zien hem in het beheer).
// Opmaak en standaardteksten staan in src/lib/email-templates.js; eigen teksten komen uit het beheer (tabel email_templates).
import type { Env } from './env';
import { rpc } from './supabase';
import { renderEmail } from '../src/lib/email-templates.js';

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
  postnl_barcode: string | null;
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

// Eigen teksten uit het beheer; lukt dat niet, dan gewoon de standaardteksten
async function overrides(env: Env) {
  try {
    return (await rpc(env, 'email_templates_all', {})) ?? {};
  } catch (e) {
    console.error('E-mailteksten laden mislukt', e);
    return {};
  }
}

export async function confirmationMail(env: Env, o: Order, origin: string) {
  return renderEmail('confirmation', o, await overrides(env), { origin });
}

export async function shippedMail(env: Env, o: Order, origin: string) {
  return renderEmail('shipped', o, await overrides(env), { origin });
}

export async function adminMail(env: Env, o: Order, origin: string) {
  return renderEmail('admin_new', o, await overrides(env), { origin, adminUrl: `${origin}/admin/#/bestelling/${o.id}` });
}
