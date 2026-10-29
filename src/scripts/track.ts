// Telt stappen in de winkel (bezoek, product, winkelwagen, afrekenen, betalen) om te zien waar bezoekers afhaken.
// Alleen een teller per dag in de database; geen cookies en niets dat naar een persoon te herleiden is.
// Elke stap telt één keer per tabblad (sessionStorage onthoudt alleen dát hij geteld is).

import { SUPABASE_URL, SUPABASE_KEY } from '../lib/supabase-config';

export type Step = 'visit' | 'product' | 'cart' | 'checkout' | 'pay';

export function track(step: Step) {
  if (!SUPABASE_URL || !SUPABASE_KEY || navigator.webdriver) return;
  const key = `knoopz-step-${step}`;
  try {
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, '1');
  } catch {
    /* geen opslag: dan telt hij gewoon */
  }
  fetch(`${SUPABASE_URL}/rest/v1/rpc/track_step`, {
    method: 'POST',
    headers: { apikey: SUPABASE_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({ p_step: step }),
    keepalive: true,
  }).catch(() => {});
}
