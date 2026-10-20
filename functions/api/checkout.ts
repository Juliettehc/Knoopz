// POST /api/checkout — bestelling aanmaken, stukken 15 minuten reserveren en een Mollie-betaling starten.
import { json, UUID, thanksPath, type Env } from '../../server/env';
import { rpc } from '../../server/supabase';
import { createPayment } from '../../server/mollie';

export const onRequestPost = async ({ request, env }: { request: Request; env: Env }) => {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'bad_request' }, 400);
  }
  const products: unknown = body?.products;
  if (!Array.isArray(products) || products.length === 0 || products.length > 20 || !products.every((p) => typeof p === 'string' && UUID.test(p))) {
    return json({ error: 'empty' }, 400);
  }
  const c = body?.customer ?? {};
  const customer = Object.fromEntries(
    ['email', 'first_name', 'last_name', 'street', 'postal_code', 'city', 'country'].map((k) => [k, typeof c[k] === 'string' ? c[k].slice(0, 200) : '']),
  );
  if (body?.terms !== true) return json({ error: 'terms' }, 400);
  const lang = body?.lang === 'en' ? 'en' : 'nl';
  const replace = typeof body?.replace === 'string' && UUID.test(body.replace) ? body.replace : null;
  const code = typeof body?.code === 'string' && body.code.trim() ? body.code.slice(0, 40) : null;

  let order: any;
  try {
    order = await rpc(env, 'create_order', { p_products: products, p_customer: customer, p_code: code, p_lang: lang, p_replace: replace });
  } catch (e) {
    console.error(e);
    return json({ error: 'server' }, 500);
  }
  if (order?.error) return json(order, order.error === 'unavailable' ? 409 : 400);

  const origin = new URL(request.url).origin;
  try {
    if (order.total_cents < 1) throw new Error('Totaalbedrag is 0');
    const payment = await createPayment(env, {
      cents: order.total_cents,
      description: `KNOOPZ ${order.number}`,
      redirectUrl: `${origin}${thanksPath(lang)}?o=${order.token}`,
      cancelUrl: `${origin}${thanksPath(lang)}?o=${order.token}`,
      webhookUrl: `${origin}/api/mollie-webhook`,
      locale: lang === 'en' ? 'en_US' : 'nl_NL',
      metadata: { order_id: order.order_id, number: order.number },
    });
    await rpc(env, 'attach_payment', { p_order: order.order_id, p_payment: payment.id });
    return json({ checkoutUrl: payment.checkoutUrl, number: order.number, token: order.token });
  } catch (e) {
    console.error(e);
    // betaling kon niet starten: reservering direct vrijgeven
    await rpc(env, 'cancel_unpaid_order', { p_order: order.order_id }).catch(() => {});
    return json({ error: 'payment' }, 502);
  }
};
