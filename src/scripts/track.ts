// Telt stappen in de winkel (bezoek, product, winkelwagen, afrekenen, betalen) om te zien waar bezoekers afhaken.
// Alleen een teller per dag in de database; geen cookies en niets dat naar een persoon te herleiden is.
// Elke stap telt één keer per tabblad (sessionStorage onthoudt alleen dát hij geteld is).

import { SUPABASE_URL, SUPABASE_KEY } from '../lib/supabase-config';

export type Step = 'visit' | 'product' | 'cart' | 'checkout' | 'pay';

// true als deze sleutel in dit tabblad nog niet geteld is
function firstTime(key: string) {
  if (!SUPABASE_URL || !SUPABASE_KEY || navigator.webdriver) return false;
  try {
    if (sessionStorage.getItem(key)) return false;
    sessionStorage.setItem(key, '1');
  } catch {
    /* geen opslag: dan telt hij gewoon */
  }
  return true;
}

const send = (fn: string, body: unknown) =>
  fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: SUPABASE_KEY, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    keepalive: true,
  }).catch(() => {});

export function track(step: Step) {
  if (firstTime(`knoopz-step-${step}`)) send('track_step', { p_step: step });
}

// Per product: bekeken of in de winkelwagen gelegd
export function trackProduct(id: string, step: 'view' | 'cart') {
  if (/^[0-9a-f-]{36}$/i.test(id) && firstTime(`knoopz-${step}-${id}`)) send('track_product', { p_product: id, p_step: step });
}
