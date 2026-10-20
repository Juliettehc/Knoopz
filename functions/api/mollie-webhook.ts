// POST /api/mollie-webhook — Mollie meldt dat de status van een betaling is veranderd.
// Mollie stuurt alleen het betaling-id; de echte status halen we zelf op bij Mollie.
import { type Env } from '../../server/env';
import { processPayment } from '../../server/payment';

export const onRequestPost = async ({ request, env }: { request: Request; env: Env }) => {
  const form = await request.formData().catch(() => null);
  const id = String(form?.get('id') ?? '');
  if (!/^tr_[A-Za-z0-9]+$/.test(id)) return new Response('ok'); // onbekend verzoek: negeren
  try {
    await processPayment(env, id, new URL(request.url).origin);
    return new Response('ok');
  } catch (e) {
    console.error(e);
    return new Response('error', { status: 500 }); // Mollie probeert het later opnieuw
  }
};
