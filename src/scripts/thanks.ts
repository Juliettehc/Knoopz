// Bedankpagina: status van de bestelling ophalen. De server vraagt de echte status na bij Mollie.
import { clearCart } from './cart';
import { PENDING_KEY } from './checkout';

export function initThanks() {
  const root = document.querySelector<HTMLElement>('[data-thanks]');
  if (!root) return;
  const lang = root.dataset.lang === 'en' ? 'en' : 'nl';
  const L: Record<string, string> = JSON.parse(root.querySelector('[data-labels]')!.textContent || '{}');
  const $ = (s: string) => root.querySelector<HTMLElement>(s)!;
  // Draaiend knoopje stoppen zodra er een uitkomst is
  const stop = () => {
    const s = root.querySelector<HTMLElement>('[data-spin]');
    if (s) s.hidden = true;
  };
  const money = (c: number) => new Intl.NumberFormat(lang === 'en' ? 'en-IE' : 'nl-NL', { style: 'currency', currency: 'EUR' }).format(c / 100);
  const token = new URLSearchParams(location.search).get('o') ?? '';
  let tries = 0;

  const forgetPending = () => {
    try {
      if (localStorage.getItem(PENDING_KEY) === token) localStorage.removeItem(PENDING_KEY);
    } catch {}
  };

  const show = (o: any) => {
    $('[data-nr]').hidden = false;
    $('[data-nr]').textContent = `${L['thanks.order']}: ${o.number}`;
    $('[data-items]').replaceChildren(
      ...o.items.map((i: any) => {
        const li = document.createElement('li');
        const a = document.createElement('span');
        a.textContent = `${i.name} (${i.code})`;
        const b = document.createElement('span');
        b.textContent = money(i.price_cents);
        li.append(a, b);
        return li;
      }),
    );
    $('[data-ship]').textContent = o.shipping_cents ? money(o.shipping_cents) : L['checkout.free'];
    $('[data-disc-row]').hidden = !o.discount_cents;
    $('[data-disc]').textContent = `− ${money(o.discount_cents)}`;
    $('[data-total]').textContent = money(o.total_cents);
    $('[data-vat]').textContent = o.vat_mode === 'kor' ? L['checkout.kor'] : L['checkout.vat'].replace('{v}', money(o.vat_cents));
    $('[data-box]').hidden = false;
  };

  async function check() {
    let o: any = null;
    try {
      const res = await fetch(`/api/order?o=${encodeURIComponent(token)}`, { cache: 'no-store' });
      if (res.status === 404) {
        { stop(); $('[data-msg]').textContent = L['thanks.notFound']; }
        return;
      }
      if (res.ok) o = await res.json();
    } catch {}

    if (o && ['paid', 'shipped', 'delivered'].includes(o.status)) {
      clearCart();
      forgetPending();
      { stop(); $('[data-msg]').textContent = L['thanks.paid'].replace('{email}', o.email); }
      show(o);
      return;
    }
    if (o && ['cancelled', 'expired', 'failed'].includes(o.status)) {
      forgetPending();
      $('[data-title]').textContent = L['thanks.failedTitle'];
      document.title = document.title.replace(L['thanks.title'], L['thanks.failedTitle']);
      { stop(); $('[data-msg]').textContent = L['thanks.failed']; }
      $('[data-retry]').hidden = false;
      return;
    }
    // nog in behandeling: even later opnieuw kijken
    if (++tries < 12) setTimeout(check, 2500);
    else { stop(); $('[data-msg]').textContent = L['thanks.slow']; }
  }

  if (!/^[0-9a-f-]{36}$/i.test(token)) {
    { stop(); $('[data-msg]').textContent = L['thanks.notFound']; }
    return;
  }
  check();
}
