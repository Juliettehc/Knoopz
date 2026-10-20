import type { Env } from './env';

const base = (env: Env) => (env.PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');

// Database-functie aanroepen met de geheime sleutel (alleen op de server).
export async function rpc<T = any>(env: Env, fn: string, args: Record<string, unknown>): Promise<T> {
  if (!env.SUPABASE_SECRET_KEY) throw new Error('SUPABASE_SECRET_KEY ontbreekt');
  const key = env.SUPABASE_SECRET_KEY;
  const headers: Record<string, string> = { 'content-type': 'application/json', apikey: key };
  if (key.startsWith('eyJ')) headers.authorization = `Bearer ${key}`; // oude service_role-sleutel
  const res = await fetch(`${base(env)}/rest/v1/rpc/${fn}`, { method: 'POST', headers, body: JSON.stringify(args) });
  if (!res.ok) throw new Error(`Supabase ${fn}: ${res.status} ${await res.text()}`);
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}

// Controleert of het token van de ingelogde gebruiker bij een beheerder hoort.
export async function isAdmin(env: Env, userToken: string): Promise<boolean> {
  if (!userToken) return false;
  const res = await fetch(`${base(env)}/rest/v1/rpc/is_admin`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: env.PUBLIC_SUPABASE_PUBLISHABLE_KEY, authorization: `Bearer ${userToken}` },
    body: '{}',
  });
  if (!res.ok) return false;
  return (await res.json()) === true;
}
