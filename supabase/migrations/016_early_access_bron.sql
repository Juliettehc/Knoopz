-- KNOOPZ: bij early access-aanmelders bijhouden waar ze vandaan komen (bijv. instagram, tiktok of de site).
-- De bron komt uit de gedeelde link: knoopz.nl/early-access/?bron=instagram
-- Uitvoeren in Supabase: SQL Editor -> + New query -> plakken -> Run. Opnieuw uitvoeren kan geen kwaad.
-- Bestaande aanmelders houden een lege bron (die waren allemaal via de site).

alter table public.early_access_signups
  add column if not exists source text check (source is null or source ~ '^[a-z0-9-]{1,30}$');

-- Aanmelden, nu met bron. De oude versie zonder bron vervalt; aanroepen zonder bron blijven werken.
drop function if exists public.early_access_signup(text, text);
create or replace function public.early_access_signup(p_email text, p_lang text, p_source text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_source text := nullif(lower(btrim(coalesce(p_source, ''))), '');
  v_id uuid;
begin
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 200 then
    return jsonb_build_object('error', 'email');
  end if;
  if v_source is not null and v_source !~ '^[a-z0-9-]{1,30}$' then
    v_source := null;
  end if;
  insert into public.early_access_signups (email, lang, source)
  values (v_email, case when p_lang = 'en' then 'en' else 'nl' end, v_source)
  on conflict (email) do nothing returning id into v_id;
  return jsonb_build_object('ok', true, 'new', v_id is not null);
end;
$$;

revoke execute on function public.early_access_signup(text, text, text) from public, anon, authenticated;
grant execute on function public.early_access_signup(text, text, text) to service_role;
