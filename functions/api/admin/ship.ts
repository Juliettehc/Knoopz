// POST /api/admin/ship — bestelling op "verzonden" zetten en de klant mailen. Alleen voor beheerders.
import { json, UUID, type Env } from '../../../server/env';
import { rpc, isAdmin } from '../../../server/supabase';
import { sendMail, shippedMail, mailEnabled, type Order } from '../../../server/mail';

export const onRequestPost = async ({ request, env }: { request: Request; env: Env }) => {
  const token = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!(await isAdmin(env, token))) return json({ error: 'forbidden' }, 403);

  const body: any = await request.json().catch(() => ({}));
  const orderId = String(body?.order_id ?? '');
  if (!UUID.test(orderId)) return json({ error: 'bad_request' }, 400);
  const tracking = typeof body?.tracking === 'string' ? body.tracking.trim().slice(0, 500) : '';

  const r = await rpc(env, 'mark_order_shipped', { p_order: orderId, p_tracking: tracking });
  if (r?.error) return json(r, 400);

  let mailed = false;
  if (body?.notify !== false && mailEnabled(env)) {
    const o = await rpc<Order>(env, 'order_by_id', { p_order: orderId });
    if (o) {
      const m = shippedMail(o);
      mailed = await sendMail(env, o.email, m.subject, m.html);
    }
  }
  return json({ ok: true, mailed, mailEnabled: mailEnabled(env) });
};
