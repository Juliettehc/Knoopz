// POST /api/admin/label — PostNL-verzendlabel aanmaken, bestelling op "verzonden" zetten en de klant de track & trace mailen.
// Bestaat er al een label, dan krijg je dat terug (geen tweede barcode, geen tweede mail). Alleen voor beheerders.
import { json, UUID, type Env } from '../../../server/env';
import { rpc, isAdmin } from '../../../server/supabase';
import { sendMail, shippedMail, mailEnabled, type Order } from '../../../server/mail';
import { createLabel, postnlEnabled, type Sender } from '../../../server/postnl';

export const onRequestPost = async ({ request, env }: { request: Request; env: Env }) => {
  const token = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!(await isAdmin(env, token))) return json({ error: 'forbidden' }, 403);

  const body: any = await request.json().catch(() => ({}));
  const orderId = String(body?.order_id ?? '');
  if (!UUID.test(orderId)) return json({ error: 'bad_request' }, 400);

  const existing = await rpc<{ barcode: string; pdf_base64: string } | null>(env, 'label_for_order', { p_order: orderId });
  if (existing && body?.again !== true) return json({ ok: true, existing: true, barcode: existing.barcode, pdf: existing.pdf_base64 });

  if (!postnlEnabled(env)) return json({ error: 'postnl_not_set' }, 400);
  const o = await rpc<Order | null>(env, 'order_by_id', { p_order: orderId });
  if (!o) return json({ error: 'not_found' }, 404);
  if (o.status !== 'paid' && o.status !== 'shipped') return json({ error: 'not_paid' }, 400);

  let label;
  try {
    const sender = await rpc<Sender>(env, 'shipping_sender_get', {});
    label = await createLabel(env, sender, o);
  } catch (e) {
    console.error(e);
    return json({ error: 'postnl', message: e instanceof Error ? e.message : String(e) }, 502);
  }

  const r = await rpc(env, 'save_label', { p_order: orderId, p_barcode: label.barcode, p_tracking: label.url, p_pdf: label.pdf });
  if (r?.error) return json(r, 400);

  let mailed = false;
  if (mailEnabled(env)) {
    const m = await shippedMail(env, { ...o, postnl_barcode: label.barcode, tracking_url: label.url }, new URL(request.url).origin);
    mailed = await sendMail(env, o.email, m.subject, m.html);
  }
  return json({ ok: true, barcode: label.barcode, tracking_url: label.url, pdf: label.pdf, mailed, mailEnabled: mailEnabled(env) });
};
