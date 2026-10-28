// GET /api/admin/config — welke koppelingen zijn ingesteld (alleen ja/nee, geen sleutels). Alleen voor beheerders.
import { json, type Env } from '../../../server/env';
import { isAdmin } from '../../../server/supabase';
import { mailEnabled } from '../../../server/mail';
import { postnlEnabled } from '../../../server/postnl';

export const onRequestGet = async ({ request, env }: { request: Request; env: Env }) => {
  const token = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!(await isAdmin(env, token))) return json({ error: 'forbidden' }, 403);
  return json({ postnl: postnlEnabled(env), mail: mailEnabled(env) });
};
