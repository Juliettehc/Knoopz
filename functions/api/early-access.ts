// POST /api/early-access — aanmelden voor early access (via de pop-up) en een bevestigingsmail sturen.
import { json, type Env } from '../../server/env';
import { rpc } from '../../server/supabase';
import { sendMail, mailEnabled, earlyAccessMail } from '../../server/mail';

export const onRequestPost = async ({ request, env }: { request: Request; env: Env }) => {
  const body: any = await request.json().catch(() => ({}));
  // Verborgen veld dat alleen spam-robots invullen, en robots die het formulier binnen een seconde versturen
  if (body?.website || (typeof body?.ms === 'number' && body.ms < 1000)) return json({ ok: true });
  const email = typeof body?.email === 'string' ? body.email.slice(0, 200) : '';
  const lang = body?.lang === 'en' ? 'en' : 'nl';
  // Waar komt de aanmelder vandaan (uit de gedeelde link, bijv. ?bron=instagram); anders de site zelf
  const source = typeof body?.source === 'string' && /^[a-z0-9-]{1,30}$/.test(body.source) ? body.source : 'site';

  let r: any;
  try {
    r = await rpc(env, 'early_access_signup', { p_email: email, p_lang: lang, p_source: source }).catch((e) => {
      // Zolang 016_early_access_bron.sql nog niet is uitgevoerd: aanmelden zonder bron
      console.error(e);
      return rpc(env, 'early_access_signup', { p_email: email, p_lang: lang });
    });
  } catch (e) {
    console.error(e);
    return json({ error: 'server' }, 500);
  }
  if (r?.error) return json(r, 400);

  // Alleen bij een nieuwe aanmelding een mail, zodat niemand via dit formulier een ander kan bestoken
  if (r.new && mailEnabled(env)) {
    try {
      const m = await earlyAccessMail(env, 'ea_signup', { lang }, new URL(request.url).origin);
      await sendMail(env, email.trim().toLowerCase(), m.subject, m.html);
    } catch (e) {
      console.error('Bevestigingsmail early access mislukt', e);
    }
  }
  return json({ ok: true });
};
