// GET /api/order?o=<token> — status van een bestelling voor de bedankpagina.
import { json, UUID, type Env } from '../../server/env';
import { rpc } from '../../server/supabase';
import { processPayment } from '../../server/payment';

export const onRequestGet = async ({ request, env }: { request: Request; env: Env }) => {
  const url = new URL(request.url);
  const token = url.searchParams.get('o') ?? '';
  if (!UUID.test(token)) return json({ error: 'not_found' }, 404);
  try {
    let o = await rpc(env, 'order_by_token', { p_token: token });
    if (!o) return json({ error: 'not_found' }, 404);
    // Webhook nog niet binnen? Dan zelf bij Mollie navragen.
    if (o.status === 'pending' && o.mollie_payment_id) {
      await processPayment(env, o.mollie_payment_id, url.origin).catch((e) => console.error(e));
      o = await rpc(env, 'order_by_token', { p_token: token });
    }
    return json({
      number: o.number,
      status: o.status,
      lang: o.lang,
      first_name: o.first_name,
      email: o.email,
      items: o.items,
      subtotal_cents: o.subtotal_cents,
      discount_cents: o.discount_cents,
      shipping_cents: o.shipping_cents,
      total_cents: o.total_cents,
      vat_mode: o.vat_mode,
      vat_cents: o.vat_cents,
    });
  } catch (e) {
    console.error(e);
    return json({ error: 'server' }, 500);
  }
};
