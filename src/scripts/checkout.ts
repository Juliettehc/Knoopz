// Afrekenpagina: overzicht (live berekend door de database), gegevens invullen en naar Mollie.
import { getCart, removeManyFromCart } from './cart';
import { SUPABASE_URL, SUPABASE_KEY, publicImageUrl } from '../lib/supabase-config';

type Quote = {
  error?: string;
  items: { product_id: string; code: string; name_nl: string; name_en: string; price_cents: number; img: string | null }[];
  unavailable: string[];
  subtotal_cents: number;
  discount_code: string | null;
  discount_error: string | null;
  discount_cents: number;
  shipping_cents: number | null;
  total_cents: number;
  vat_mode: 'incl21' | 'kor';
  vat_cents: number;
};

const DETAILS_KEY = 'knoopz-checkout-details';
export const PENDING_KEY = 'knoopz-pending-order';
const UUID = /^[0-9a-f-]{36}$/i;
const pendingToken = () => {
  try {
    const v = localStorage.getItem(PENDING_KEY) || '';
    return UUID.test(v) ? v : null;
  } catch {
    return null;
  }
};
const FIELDS = ['email', 'first_name', 'last_name', 'street', 'postal_code', 'city', 'country'] as const;

export function initCheckout() {
  const root = document.querySelector<HTMLElement>('[data-checkout]');
  if (!root) return;
  const lang = root.dataset.lang === 'en' ? 'en' : 'nl';
  const L: Record<string, string> = JSON.parse(root.querySelector('[data-labels]')!.textContent || '{}');
  const $ = <T extends HTMLElement = HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
  const form = $<HTMLFormElement>('[data-form]');
  const alertEl = $('[data-alert]');
  const codeInput = $<HTMLInputElement>('[data-code]');
  const codeMsg = $('[data-code-msg]');
  const payBtn = $<HTMLButtonElement>('[data-pay]');
  const field = (n: string) => form.elements.namedItem(n) as HTMLInputElement | HTMLSelectElement;
  const money = (c: number) => new Intl.NumberFormat(lang === 'en' ? 'en-IE' : 'nl-NL', { style: 'currency', currency: 'EUR' }).format(c / 100);

  let appliedCode: string | null = null;
  let quote: Quote | null = null;

  const showAlert = (msg: string | null) => {
    alertEl.textContent = msg ?? '';
    alertEl.hidden = !msg;
    if (msg) alertEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  // Eerder ingevulde gegevens terugzetten (alleen in deze browser)
  try {
    const saved = JSON.parse(localStorage.getItem(DETAILS_KEY) || '{}');
    FIELDS.forEach((k) => k !== 'country' && typeof saved[k] === 'string' && (field(k).value = saved[k]));
  } catch {}
  const saveDetails = () => {
    try {
      localStorage.setItem(DETAILS_KEY, JSON.stringify(Object.fromEntries(FIELDS.map((k) => [k, field(k).value.trim()]))));
    } catch {}
  };

  const setPostalPattern = () => {
    const pc = field('postal_code') as HTMLInputElement;
    const be = field('country').value === 'BE';
    pc.pattern = be ? '[0-9]{4}' : '[0-9]{4} ?[A-Za-z]{2}';
    pc.placeholder = be ? '1000' : '1234 AB';
    pc.inputMode = be ? 'numeric' : 'text';
  };
  setPostalPattern();

  async function loadQuote() {
    const ids = getCart();
    if (ids.length === 0) {
      $('[data-main]').hidden = true;
      $('[data-empty]').hidden = false;
      return;
    }
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/quote_order`, {
        method: 'POST',
        headers: { apikey: SUPABASE_KEY, 'content-type': 'application/json' },
        body: JSON.stringify({ p_products: ids, p_country: field('country').value, p_code: appliedCode, p_own: pendingToken() }),
      });
      if (!res.ok) throw new Error(String(res.status));
      quote = await res.json();
    } catch {
      showAlert(L['err.server']);
      return;
    }
    if (!quote || quote.error) return showAlert(L[`err.${quote?.error}`] ?? L['err.server']);

    if (quote.unavailable.length) {
      removeManyFromCart(quote.unavailable);
      showAlert(L['err.unavailable']);
      if (quote.items.length === 0) return loadQuote();
    }
    render();
  }

  function render() {
    if (!quote) return;
    $('[data-loading]').hidden = true;
    $('[data-items]').replaceChildren(
      ...quote.items.map((i) => {
        const li = document.createElement('li');
        const img = document.createElement(i.img ? 'img' : 'span');
        img.className = 'ci-img';
        if (i.img) Object.assign(img, { src: publicImageUrl(i.img), alt: '', loading: 'lazy' });
        const info = document.createElement('div');
        info.className = 'ci-info';
        const name = document.createElement('span');
        name.textContent = lang === 'en' ? i.name_en : i.name_nl;
        const sub = document.createElement('span');
        sub.className = 'ci-sub';
        sub.textContent = `${i.code} · ${L['checkout.unique']}`;
        info.append(name, sub);
        const price = document.createElement('span');
        price.className = 'ci-price';
        price.textContent = money(i.price_cents);
        li.append(img, info, price);
        return li;
      }),
    );
    $('[data-totals]').hidden = false;
    $('[data-sub]').textContent = money(quote.subtotal_cents);
    const hasDisc = !!quote.discount_code && quote.discount_cents > 0;
    $('[data-disc-row]').hidden = !hasDisc;
    $('[data-disc-code]').textContent = hasDisc ? `(${quote.discount_code})` : '';
    $('[data-disc]').textContent = `− ${money(quote.discount_cents)}`;
    $('[data-ship]').textContent = quote.shipping_cents === null ? '—' : quote.shipping_cents === 0 ? L['checkout.free'] : money(quote.shipping_cents);
    $('[data-total]').textContent = money(quote.total_cents);
    $('[data-vat]').textContent = quote.vat_mode === 'kor' ? L['checkout.kor'] : L['checkout.vat'].replace('{v}', money(quote.vat_cents));

    if (appliedCode) {
      if (quote.discount_error) {
        codeMsg.textContent = L[`err.${quote.discount_error}`] ?? L['err.invalid'];
        codeMsg.className = 'co-msg bad';
        appliedCode = null;
      } else {
        codeMsg.textContent = `${quote.discount_code}: − ${money(quote.discount_cents)}`;
        codeMsg.className = 'co-msg ok';
      }
      codeMsg.hidden = false;
    }
  }

  // Kortingscode
  const applyCode = async () => {
    const v = codeInput.value.trim().toUpperCase();
    codeMsg.hidden = true;
    appliedCode = v || null;
    await loadQuote();
  };
  $('[data-apply]').addEventListener('click', applyCode);
  codeInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      applyCode();
    }
  });

  field('country').addEventListener('change', () => {
    setPostalPattern();
    loadQuote();
  });

  // Bestellen en betalen
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    showAlert(null);
    let firstBad: HTMLElement | null = null;
    FIELDS.forEach((k) => {
      const el = field(k);
      if (el instanceof HTMLInputElement) el.value = el.value.trim();
      const ok = el.checkValidity();
      el.setAttribute('aria-invalid', String(!ok));
      if (!ok && !firstBad) firstBad = el;
    });
    if (firstBad) {
      showAlert(L['err.customer']);
      (firstBad as HTMLElement).focus();
      return;
    }
    if (!(form.elements.namedItem('terms') as HTMLInputElement).checked) return showAlert(L['err.terms']);
    if (codeInput.value.trim() && codeInput.value.trim().toUpperCase() !== (quote?.discount_code ?? '')) {
      await applyCode();
      if (!appliedCode) return;
    }
    saveDetails();

    payBtn.disabled = true;
    payBtn.setAttribute('aria-busy', 'true');
    const label = payBtn.textContent;
    payBtn.textContent = L['checkout.busy'];
    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          products: getCart(),
          customer: Object.fromEntries(FIELDS.map((k) => [k, field(k).value])),
          code: appliedCode,
          terms: true,
          lang,
          replace: pendingToken(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.checkoutUrl) {
        try {
          localStorage.setItem(PENDING_KEY, data.token);
        } catch {}
        location.href = data.checkoutUrl;
        return;
      }
      if (data.error === 'unavailable') {
        removeManyFromCart(data.unavailable ?? []);
        await loadQuote();
        showAlert(L['err.unavailable']);
      } else if (data.error === 'discount') {
        showAlert(L[`err.${data.reason}`] ?? L['err.invalid']);
      } else {
        showAlert(L[`err.${data.error}`] ?? L['err.server']);
      }
    } catch {
      showAlert(L['err.server']);
    }
    payBtn.disabled = false;
    payBtn.removeAttribute('aria-busy');
    payBtn.textContent = label;
  });

  // Terug via de knop "vorige" van de browser (vanaf Mollie): overzicht vernieuwen
  window.addEventListener('pageshow', (e) => {
    if (e.persisted) {
      payBtn.disabled = false;
      payBtn.removeAttribute('aria-busy');
      payBtn.textContent = L['checkout.pay'];
      loadQuote();
    }
  });

  loadQuote();
}
