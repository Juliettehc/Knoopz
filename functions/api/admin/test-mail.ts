// POST /api/admin/test-mail — alle e-mails (NL en EN) met een voorbeeldbestelling naar één adres sturen,
// met de teksten zoals ze nu in het beheer staan. Alleen voor beheerders.
import { json, type Env } from '../../../server/env';
import { isAdmin } from '../../../server/supabase';
import { sendMail, mailEnabled, confirmationMail, shippedMail, adminMail, type Order } from '../../../server/mail';
import { SAMPLE_ORDER } from '../../../src/lib/email-templates.js';

export const onRequestPost = async ({ request, env }: { request: Request; env: Env }) => {
  const token = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!(await isAdmin(env, token))) return json({ error: 'forbidden' }, 403);
  if (!mailEnabled(env)) return json({ error: 'mail_not_set' }, 400);

  const body: any = await request.json().catch(() => ({}));
  const to = typeof body?.to === 'string' ? body.to.trim().slice(0, 200) : '';
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return json({ error: 'email' }, 400);

  const origin = new URL(request.url).origin;
  const nl = { ...SAMPLE_ORDER, lang: 'nl' } as Order;
  const en = { ...SAMPLE_ORDER, lang: 'en' } as Order;
  const mails = [
    await confirmationMail(env, nl, origin),
    await shippedMail(env, nl, origin),
    await adminMail(env, nl, origin),
    await confirmationMail(env, en, origin),
    await shippedMail(env, en, origin),
  ];
  let sent = 0;
  for (const m of mails) if (await sendMail(env, to, `[TEST] ${m.subject}`, m.html)) sent++;
  return json({ ok: sent === mails.length, sent, total: mails.length });
};
