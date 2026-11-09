// POST /api/admin/early-access — de early access-mail versturen. Alleen voor beheerders.
//   { action: 'test', drop_id, to }  -> beide mails (NL en EN) met de echte link naar één adres
//   { action: 'send', drop_id }      -> de mail met de link naar alle aanmelders die hem nog niet kregen
import { json, UUID, type Env } from '../../../server/env';
import { isAdmin, rpc } from '../../../server/supabase';
import { sendMail, mailEnabled, earlyAccessMail } from '../../../server/mail';
import { dropLink } from '../../../server/early-access';

type Info = { slug: string; name_nl: string; name_en: string | null; code: string; early_access_start: string | null; public_start: string | null };

export const onRequestPost = async ({ request, env }: { request: Request; env: Env }) => {
  const token = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!(await isAdmin(env, token))) return json({ error: 'forbidden' }, 403);
  if (!mailEnabled(env)) return json({ error: 'mail_not_set', message: 'E-mail is nog niet ingesteld (RESEND_API_KEY en MAIL_FROM).' }, 400);

  const body: any = await request.json().catch(() => ({}));
  const dropId = typeof body?.drop_id === 'string' && UUID.test(body.drop_id) ? body.drop_id : '';
  if (!dropId) return json({ error: 'drop' }, 400);
  const info = await rpc<Info | null>(env, 'early_access_info', { p_drop: dropId });
  if (!info?.code) return json({ error: 'not_set', message: 'Sla eerst de early access van deze drop op (met code).' }, 400);

  const origin = new URL(request.url).origin;
  const mail = async (lang: 'nl' | 'en') =>
    earlyAccessMail(env, 'ea_open', { lang, drop_name: (lang === 'en' && info.name_en) || info.name_nl }, origin, dropLink(origin, lang, info.slug, info.code));

  if (body?.action === 'test') {
    const to = typeof body?.to === 'string' ? body.to.trim().slice(0, 200) : '';
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return json({ error: 'email', message: 'Vul een geldig e-mailadres in.' }, 400);
    const signup = await earlyAccessMail(env, 'ea_signup', { lang: 'nl' }, origin);
    const mails = [signup, await mail('nl'), await mail('en')];
    let sent = 0;
    for (const m of mails) if (await sendMail(env, to, `[TEST] ${m.subject}`, m.html)) sent++;
    return json({ ok: sent === mails.length, sent, total: mails.length });
  }

  if (body?.action !== 'send') return json({ error: 'action' }, 400);
  // Pas versturen als de early access echt open is, anders werkt de link nog niet
  if (!info.early_access_start || Date.parse(info.early_access_start) > Date.now()) {
    return json({ error: 'not_open', message: 'De early access van deze drop is nog niet begonnen. Pas de starttijd aan of wacht tot hij open is.' }, 400);
  }

  const recipients = await rpc<{ email: string; lang: 'nl' | 'en' }[]>(env, 'early_access_recipients', { p_drop: dropId });
  const content = { nl: await mail('nl'), en: await mail('en') };
  let sent = 0;
  let failed = 0;
  // Resend verstuurt maximaal 100 mails per keer; per groep onthouden wie hem gekregen heeft
  for (let i = 0; i < recipients.length; i += 100) {
    const group = recipients.slice(i, i + 100);
    const res = await fetch(`${env.RESEND_API_BASE || 'https://api.resend.com'}/emails/batch`, {
      method: 'POST',
      headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify(
        group.map((r) => ({
          from: env.MAIL_FROM,
          to: [r.email],
          subject: content[r.lang === 'en' ? 'en' : 'nl'].subject,
          html: content[r.lang === 'en' ? 'en' : 'nl'].html,
          ...(env.MAIL_REPLY_TO ? { reply_to: env.MAIL_REPLY_TO } : {}),
        })),
      ),
    });
    if (!res.ok) {
      console.error('Early access-mail mislukt', res.status, await res.text());
      failed += group.length;
      continue;
    }
    sent += await rpc<number>(env, 'early_access_mark_sent', { p_drop: dropId, p_emails: group.map((r) => r.email) });
  }
  return json({ ok: failed === 0, sent, failed, total: recipients.length });
};
