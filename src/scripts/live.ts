// Live voorraadcontrole in de browser.
// De pagina's zijn vooraf gebouwd; dit script vraagt bij Supabase op of producten intussen verkocht zijn
// en past "Sold out" en de koopknop direct aan.

import { SUPABASE_URL, SUPABASE_KEY } from '../lib/supabase-config';

export type LiveStatus = Map<string, 'available' | 'sold'>;

const UUID = /^[0-9a-f-]{36}$/i;

export async function fetchStatus(ids: string[]): Promise<LiveStatus> {
  const map: LiveStatus = new Map();
  const valid = [...new Set(ids)].filter((id) => UUID.test(id));
  if (!SUPABASE_URL || !SUPABASE_KEY || valid.length === 0) return map;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/product_variants?select=product_id,status,stock&product_id=in.(${valid.join(',')})`,
      { headers: { apikey: SUPABASE_KEY } },
    );
    if (!res.ok) return map;
    const rows: { product_id: string; status: string; stock: number }[] = await res.json();
    for (const id of valid) {
      const vs = rows.filter((r) => r.product_id === id);
      map.set(id, vs.some((v) => v.status !== 'sold' && v.stock > 0) ? 'available' : 'sold');
    }
  } catch {
    /* geen verbinding: de gebouwde status blijft staan */
  }
  return map;
}

export function applyStatus(root: ParentNode, status: LiveStatus) {
  root.querySelectorAll<HTMLElement>('[data-product-id]').forEach((el) => {
    const s = status.get(el.dataset.productId!);
    if (!s) return;
    const sold = s === 'sold';
    el.dataset.status = s;
    el.querySelectorAll<HTMLElement>('[data-sold-show]').forEach((x) => (x.hidden = !sold));
    el.querySelectorAll<HTMLElement>('[data-sold-hide]').forEach((x) => (x.hidden = sold));
    el.querySelectorAll<HTMLElement>('[data-price]').forEach((x) => (x.textContent = sold ? x.dataset.labelSold! : x.dataset.labelPrice!));
  });
  document.dispatchEvent(new CustomEvent('knoopz:status-updated'));
}

export async function refreshLiveStatus() {
  const ids = [...document.querySelectorAll<HTMLElement>('[data-product-id]')].map((el) => el.dataset.productId!);
  if (ids.length === 0) return;
  applyStatus(document, await fetchStatus(ids));
}
