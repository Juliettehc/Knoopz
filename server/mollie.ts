import type { Env } from './env';

const base = (env: Env) => env.MOLLIE_API_BASE || 'https://api.mollie.com/v2';

async function call(env: Env, path: string, init: RequestInit = {}) {
  if (!env.MOLLIE_API_KEY) throw new Error('MOLLIE_API_KEY ontbreekt');
  const res = await fetch(`${base(env)}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${env.MOLLIE_API_KEY}`, 'content-type': 'application/json' },
  });
  const body: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Mollie ${path}: ${res.status} ${body?.detail || body?.title || ''}`);
  return body;
}

export async function createPayment(
  env: Env,
  p: { cents: number; description: string; redirectUrl: string; cancelUrl: string; webhookUrl: string; locale: string; metadata: Record<string, string> },
) {
  const body = await call(env, '/payments', {
    method: 'POST',
    body: JSON.stringify({
      amount: { currency: 'EUR', value: (p.cents / 100).toFixed(2) },
      description: p.description,
      redirectUrl: p.redirectUrl,
      cancelUrl: p.cancelUrl,
      webhookUrl: p.webhookUrl,
      locale: p.locale,
      metadata: p.metadata,
    }),
  });
  return { id: body.id as string, checkoutUrl: body?._links?.checkout?.href as string };
}

export async function getPayment(env: Env, id: string) {
  const body = await call(env, `/payments/${encodeURIComponent(id)}`);
  return { id: body.id as string, status: body.status as string, method: (body.method ?? null) as string | null, metadata: body.metadata ?? {} };
}
