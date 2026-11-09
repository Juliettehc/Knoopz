// Aanmeldpagina /early-access/: titel, tekst en foto van de pop-up ook in de voorvertoning bij delen
// (Instagram, TikTok, WhatsApp lezen alleen de HTML, geen JavaScript). Altijd de actuele pop-up uit het beheer.
import type { Env } from './env';

declare const HTMLRewriter: any;

const plain = (s: string) => s.replace(/\*\*/g, '').replace(/^#+\s*/gm, '').replace(/\s+/g, ' ').trim().slice(0, 200);

export const withPopupMeta = (lang: 'nl' | 'en') => async ({ next, env }: { next: () => Promise<Response>; env: Env }) => {
  const res = await next();
  if (!res.ok || !(res.headers.get('content-type') || '').includes('text/html')) return res;
  const base = (env.PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');
  let row: any = null;
  try {
    const r = await fetch(`${base}/rest/v1/early_access_popup?select=title_nl,title_en,text_nl,text_en,image_path&id=eq.1`, {
      headers: { apikey: env.PUBLIC_SUPABASE_PUBLISHABLE_KEY },
    });
    if (r.ok) row = (await r.json())[0] ?? null;
  } catch {
    /* geen pop-up-gegevens: pagina zoals gebouwd */
  }
  if (!row) return res;
  const title = (lang === 'en' && row.title_en) || row.title_nl || '';
  const desc = plain((lang === 'en' && row.text_en) || row.text_nl || '');
  const img = row.image_path ? `${base}/storage/v1/object/public/product-images/${row.image_path}` : '';
  const set = (content: string) => ({ element: (e: any) => e.setAttribute('content', content) });

  let rw = new HTMLRewriter();
  if (title) {
    rw = rw
      .on('title', { element: (e: any) => e.setInnerContent(`${title} · KNOOPZ`) })
      .on('meta[property="og:title"]', set(`${title} · KNOOPZ`));
  }
  if (desc) rw = rw.on('meta[name="description"]', set(desc)).on('meta[property="og:description"]', set(desc));
  if (img) {
    rw = rw
      .on('meta[property="og:image"]', set(img))
      .on('head', { element: (e: any) => e.append('<meta name="twitter:card" content="summary_large_image" />', { html: true }) });
  }
  const out = rw.transform(res);
  const headers = new Headers(out.headers);
  headers.set('cache-control', 'public, max-age=300');
  return new Response(out.body, { status: out.status, headers });
};
