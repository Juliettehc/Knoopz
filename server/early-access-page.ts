// Serveert de early access-pagina voor drops die (nog) niet in de gebouwde site staan.
type Ctx = { request: Request; next: () => Promise<Response>; env: { ASSETS: { fetch: (r: Request | string) => Promise<Response> } } };

export const earlyAccessPage = (lang: 'nl' | 'en') => async ({ request, next, env }: Ctx) => {
  const res = await next();
  if (res.status !== 404) return res;
  const url = new URL(request.url);
  const slug = url.pathname.replace(/^\/(en\/)?drops\//, '').split('/')[0];
  if (!/^[a-z0-9-]{1,80}$/.test(slug)) return res;
  // Zonder slash op het eind laden de relatieve paden niet goed
  if (!url.pathname.endsWith('/')) return Response.redirect(`${url.origin}${url.pathname}/${url.search}`, 301);
  const page = await env.ASSETS.fetch(new Request(new URL(lang === 'en' ? '/en/early-access/' : '/early-access/', url.origin)));
  if (!page.ok) return res;
  const headers = new Headers(page.headers);
  headers.set('cache-control', 'no-store');
  headers.set('x-robots-tag', 'noindex');
  return new Response(page.body, { status: 200, headers });
};
