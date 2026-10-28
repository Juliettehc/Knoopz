// POST /api/admin/track — bij PostNL navragen welke verzonden pakketten bezorgd zijn, en die op "bezorgd" zetten.
// Wordt aangeroepen als je de bestellingen opent in het beheer. Automatisch kan ook: laat een cron-dienst
// (bijv. cron-job.org) elk uur GET /api/admin/track?key=<CRON_SECRET> aanroepen.
import { json, type Env } from '../../../server/env';
import { rpc, isAdmin } from '../../../server/supabase';
import { deliveryStatus, postnlEnabled } from '../../../server/postnl';

async function allowed(request: Request, env: Env) {
  const key = new URL(request.url).searchParams.get('key');
  if (env.CRON_SECRET && key && key === env.CRON_SECRET) return true;
  const token = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  return isAdmin(env, token);
}

async function run(request: Request, env: Env) {
  if (!(await allowed(request, env))) return json({ error: 'forbidden' }, 403);
  if (!postnlEnabled(env)) return json({ ok: true, checked: 0, delivered: [] });
  const list = await rpc<{ id: string; barcode: string }[]>(env, 'orders_to_track', { p_limit: 25 });
  const delivered: string[] = [];
  await Promise.all(
    (list ?? []).map(async (o) => {
      try {
        const s = await deliveryStatus(env, o.barcode);
        if (s.delivered && (await rpc(env, 'mark_delivered', { p_order: o.id, p_at: s.at }))) delivered.push(o.id);
      } catch (e) {
        console.error('Status PostNL', o.barcode, e);
      }
    }),
  );
  return json({ ok: true, checked: list?.length ?? 0, delivered });
}

export const onRequestPost = ({ request, env }: { request: Request; env: Env }) => run(request, env);
export const onRequestGet = ({ request, env }: { request: Request; env: Env }) => run(request, env);
