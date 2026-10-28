// Betaalstatus bij Mollie opvragen en verwerken. Wordt gebruikt door de webhook én door de bedankpagina
// (als de webhook nog niet binnen is). Mollie is altijd de bron van waarheid; we vertrouwen nooit wat de browser zegt.
import type { Env } from './env';
import { rpc } from './supabase';
import { getPayment } from './mollie';
import { sendMail, confirmationMail, adminMail, type Order } from './mail';

export async function processPayment(env: Env, paymentId: string, origin: string) {
  const payment = await getPayment(env, paymentId);
  const orderId = payment.metadata?.order_id;
  if (!orderId) return { error: 'no_order' };

  const result = await rpc(env, 'apply_payment_status', {
    p_order: orderId,
    p_payment: payment.id,
    p_status: payment.status,
    p_method: payment.method,
  });

  if (result?.changed && result.status === 'paid') {
    const order = await rpc<Order>(env, 'order_by_id', { p_order: orderId });
    if (order) {
      const first = await rpc<boolean | null>(env, 'mark_confirmation_sent', { p_order: orderId });
      if (first) {
        const m = await confirmationMail(env, order, origin);
        await sendMail(env, order.email, m.subject, m.html);
        const admins = await rpc<string[]>(env, 'admin_emails', {});
        if (admins?.length) {
          const a = await adminMail(env, order, origin);
          await sendMail(env, admins, a.subject, a.html);
        }
      }
    }
  }
  return result;
}
