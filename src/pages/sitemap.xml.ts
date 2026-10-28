// Sitemap voor Google: alle openbare pagina's in beide talen, plus drops en producten.
import type { APIRoute } from 'astro';
import { loadCatalog } from '../data/catalog';
import { routes, dropPath, productPath, type Lang, type RouteKey } from '../i18n/ui';

const hidden: RouteKey[] = ['checkout', 'thanks'];

export const GET: APIRoute = async ({ site }) => {
  const base = site ?? new URL('https://knoopz.nl');
  const { drops, products } = await loadCatalog();
  const pairs: { nl: string; en: string }[] = [
    ...(Object.keys(routes) as RouteKey[]).filter((k) => !hidden.includes(k)).map((k) => routes[k]),
    ...drops.map((d) => ({ nl: dropPath('nl', d.slug), en: dropPath('en', d.slug) })),
    ...products.map((p) => ({ nl: productPath('nl', p.slug), en: productPath('en', p.slug) })),
  ];
  const abs = (path: string) => new URL(path, base).href;
  const entry = (pair: { nl: string; en: string }, lang: Lang) =>
    `  <url>\n    <loc>${abs(pair[lang])}</loc>\n` +
    `    <xhtml:link rel="alternate" hreflang="nl" href="${abs(pair.nl)}"/>\n` +
    `    <xhtml:link rel="alternate" hreflang="en" href="${abs(pair.en)}"/>\n  </url>`;
  const body =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n` +
    pairs.flatMap((p) => [entry(p, 'nl'), entry(p, 'en')]).join('\n') +
    `\n</urlset>\n`;
  return new Response(body, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
};
