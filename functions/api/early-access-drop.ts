// POST /api/early-access-drop — een drop die nog niet publiek is ophalen, alleen met de juiste toegangscode.
//   { slug, access: [code] }  -> { state: 'none' | 'closed' | 'open' | 'public', drop?, products?, public_start? }
//   { items: [id], access }   -> { items: [...] }  (voor de winkelwagen)
// De controle gebeurt in de database met de geheime sleutel; bezoekers kunnen deze gegevens zelf niet lezen.
import { json, UUID, type Env } from '../../server/env';
import { rpc } from '../../server/supabase';
import { accessCodes } from '../../server/early-access';

export const onRequestPost = async ({ request, env }: { request: Request; env: Env }) => {
  const body: any = await request.json().catch(() => ({}));
  const access = accessCodes(body?.access);
  try {
    if (Array.isArray(body?.items)) {
      const ids = body.items.filter((x: unknown) => typeof x === 'string' && UUID.test(x)).slice(0, 20);
      if (ids.length === 0) return json({ items: [] });
      return json({ items: await rpc(env, 'early_access_items', { p_products: ids, p_access: access }) });
    }
    const slug = typeof body?.slug === 'string' ? body.slug : '';
    if (!/^[a-z0-9-]{1,80}$/.test(slug)) return json({ state: 'none' });
    return json(await rpc(env, 'early_access_drop', { p_slug: slug, p_access: access }));
  } catch (e) {
    console.error(e);
    return json({ error: 'server' }, 500);
  }
};
