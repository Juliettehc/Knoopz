// POST /api/contact — bericht via het contactformulier opslaan en (als e-mail is ingesteld) doorsturen naar de beheerders.
import { json, type Env } from '../../server/env';
import { rpc } from '../../server/supabase';
import { mailEnabled } from '../../server/mail';

const esc = (v: unknown) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export const onRequestPost = async ({ request, env }: { request: Request; env: Env }) => {
  const body: any = await request.json().catch(() => ({}));
  // Verborgen veld dat alleen spam-robots invullen
  if (body?.website) return json({ ok: true });
  const name = typeof body?.name === 'string' ? body.name.slice(0, 100) : '';
  const email = typeof body?.email === 'string' ? body.email.slice(0, 200) : '';
  const message = typeof body?.message === 'string' ? body.message.slice(0, 5000) : '';
  const lang = body?.lang === 'en' ? 'en' : 'nl';

  let r: any;
  try {
    r = await rpc(env, 'submit_contact', { p_name: name, p_email: email, p_message: message, p_lang: lang });
  } catch (e) {
    console.error(e);
    return json({ error: 'server' }, 500);
  }
  if (r?.error) return json(r, r.error === 'too_many' ? 429 : 400);

  if (mailEnabled(env)) {
    try {
      const admins = await rpc<string[]>(env, 'admin_emails', {});
      if (admins?.length) {
        const origin = new URL(request.url).origin;
        await fetch(`${env.RESEND_API_BASE || 'https://api.resend.com'}/emails`, {
          method: 'POST',
          headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
          body: JSON.stringify({
            from: env.MAIL_FROM,
            to: admins,
            reply_to: email,
            subject: `Nieuw bericht van ${name} · KNOOPZ`,
            html: `<p><strong>${esc(name)}</strong> (${esc(email)}) schreef:</p><p style="white-space:pre-wrap">${esc(message)}</p><p><a href="${origin}/admin/#/contact">Bekijk in het beheer</a> · Beantwoorden kan direct vanuit je mail.</p>`,
          }),
        });
      }
    } catch (e) {
      console.error('Mail contactbericht mislukt', e);
    }
  }
  return json({ ok: true });
};

