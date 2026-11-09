-- KNOOPZ: early access voor drops.
--   - pop-up op de site waarmee bezoekers zich aanmelden met hun e-mailadres
--   - per drop: start early access, publieke start en één gedeelde toegangscode (de link in de mail)
--   - een drop die nog niet publiek is, is voor bezoekers onzichtbaar; alleen met de juiste code via de server
-- Uitvoeren in Supabase: SQL Editor -> + New query -> plakken -> Run. Opnieuw uitvoeren kan geen kwaad.
-- Dit script wijzigt geen bestaande gegevens. De beveiliging voor bezoekers wordt alleen strenger, nergens ruimer.

-- ---------------------------------------------------------------
-- 1. Tabellen
-- ---------------------------------------------------------------

-- Early access per drop. Staat bewust NIET op de tabel drops: die is voor bezoekers leesbaar,
-- en de toegangscode mag nooit bij bezoekers terechtkomen.
create table if not exists public.drop_early_access (
  drop_id uuid primary key references public.drops (id) on delete cascade,
  code text not null check (code ~ '^[a-z0-9-]{4,40}$'),
  early_access_start timestamptz,
  public_start timestamptz,
  updated_at timestamptz not null default now(),
  check (early_access_start is null or public_start is null or early_access_start < public_start)
);

-- Aanmeldingen via de pop-up
create table if not exists public.early_access_signups (
  id uuid primary key default gen_random_uuid(),
  email text not null unique check (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and length(email) <= 200),
  lang text not null default 'nl' check (lang in ('nl', 'en')),
  created_at timestamptz not null default now()
);

-- Wie heeft de early access-mail van welke drop al gekregen (zo krijgt niemand hem twee keer)
create table if not exists public.early_access_sends (
  drop_id uuid not null references public.drops (id) on delete cascade,
  email text not null,
  sent_at timestamptz not null default now(),
  primary key (drop_id, email)
);

-- Instellingen van de pop-up (één regel). Wat hier staat is openbare tekst, dus bezoekers mogen het lezen.
create table if not exists public.early_access_popup (
  id integer primary key default 1 check (id = 1),
  enabled boolean not null default false,
  image_path text,
  title_nl text,
  title_en text,
  text_nl text,
  text_en text,
  updated_at timestamptz not null default now()
);
insert into public.early_access_popup (id) values (1) on conflict (id) do nothing;

drop trigger if exists drop_early_access_touch on public.drop_early_access;
create trigger drop_early_access_touch before update on public.drop_early_access for each row execute function public.touch_updated_at();
drop trigger if exists early_access_popup_touch on public.early_access_popup;
create trigger early_access_popup_touch before update on public.early_access_popup for each row execute function public.touch_updated_at();

-- E-mailteksten: twee nieuwe mails (aanmelding bevestigd, early access is open)
alter table public.email_templates drop constraint if exists email_templates_key_check;
alter table public.email_templates add constraint email_templates_key_check
  check (key in ('confirmation', 'shipped', 'admin_new', 'footer', 'ea_signup', 'ea_open'));

-- ---------------------------------------------------------------
-- 2. Beveiliging van de nieuwe tabellen
-- ---------------------------------------------------------------
alter table public.drop_early_access enable row level security;
alter table public.early_access_signups enable row level security;
alter table public.early_access_sends enable row level security;
alter table public.early_access_popup enable row level security;

revoke all on public.drop_early_access, public.early_access_signups, public.early_access_sends from anon;
revoke all on public.early_access_popup from anon;
grant select on public.early_access_popup to anon;
grant select, insert, update, delete on public.drop_early_access to authenticated;
grant select, delete on public.early_access_signups to authenticated;
grant select on public.early_access_sends to authenticated;
grant select, update on public.early_access_popup to authenticated;

drop policy if exists "early access beheren" on public.drop_early_access;
create policy "early access beheren" on public.drop_early_access
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "aanmelders lezen" on public.early_access_signups;
create policy "aanmelders lezen" on public.early_access_signups for select to authenticated using (public.is_admin());
drop policy if exists "aanmelders verwijderen" on public.early_access_signups;
create policy "aanmelders verwijderen" on public.early_access_signups for delete to authenticated using (public.is_admin());
drop policy if exists "verstuurde mails lezen" on public.early_access_sends;
create policy "verstuurde mails lezen" on public.early_access_sends for select to authenticated using (public.is_admin());
drop policy if exists "pop-up lezen" on public.early_access_popup;
create policy "pop-up lezen" on public.early_access_popup for select using (true);
drop policy if exists "pop-up beheren" on public.early_access_popup;
create policy "pop-up beheren" on public.early_access_popup
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------
-- 3. Wanneer is een drop publiek, en wanneer geeft een code toegang?
-- ---------------------------------------------------------------

-- Publiek = op "Zichtbaar op de website" én de publieke start is voorbij (of niet ingesteld).
create or replace function public.drop_is_public(p_drop uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.drops d left join public.drop_early_access e on e.drop_id = d.id
    where d.id = p_drop and d.published and (e.public_start is null or e.public_start <= now())
  );
$$;

-- Toegang met code: de code klopt en de early access is begonnen.
create or replace function public.drop_access_ok(p_drop uuid, p_access text[])
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.drop_early_access e
    where e.drop_id = p_drop and e.early_access_start is not null and e.early_access_start <= now()
      and e.code = any (select lower(btrim(x)) from unnest(coalesce(p_access, '{}'::text[])) x)
  );
$$;

-- Welke van deze producten mag je (nog) niet kopen: ze horen bij een drop die niet publiek is en je hebt geen geldige code.
create or replace function public.blocked_products(p_products uuid[], p_access text[] default null)
returns uuid[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(p.id), '{}'::uuid[]) from public.products p
  where p.id = any (coalesce(p_products, '{}'::uuid[])) and p.drop_id is not null
    and not public.drop_is_public(p.drop_id) and not public.drop_access_ok(p.drop_id, p_access);
$$;

-- ---------------------------------------------------------------
-- 4. Bezoekers mogen alleen publieke drops en hun producten lezen (strenger dan voorheen)
-- ---------------------------------------------------------------
drop policy if exists "drops lezen" on public.drops;
create policy "drops lezen" on public.drops
  for select using (public.is_admin() or (published and public.drop_is_public(id)));

drop policy if exists "producten lezen" on public.products;
create policy "producten lezen" on public.products
  for select using (public.is_admin() or (published and (drop_id is null or public.drop_is_public(drop_id))));

drop policy if exists "varianten lezen" on public.product_variants;
create policy "varianten lezen" on public.product_variants
  for select using (
    public.is_admin()
    or exists (select 1 from public.products p where p.id = product_id and p.published
               and (p.drop_id is null or public.drop_is_public(p.drop_id)))
  );

drop policy if exists "fotos lezen" on public.product_images;
create policy "fotos lezen" on public.product_images
  for select using (
    public.is_admin()
    or exists (select 1 from public.products p where p.id = product_id and p.published
               and (p.drop_id is null or public.drop_is_public(p.drop_id)))
  );

-- ---------------------------------------------------------------
-- 5. Afrekenpagina: producten uit een niet-publieke drop alleen met geldige code
--    (de oude versie zonder p_access vervalt; de huidige site blijft werken omdat p_access optioneel is)
-- ---------------------------------------------------------------
drop function if exists public.quote_order(uuid[], text, text, uuid);
create or replace function public.quote_order(p_products uuid[], p_country text default 'NL', p_code text default null, p_own uuid default null, p_access text[] default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_blocked uuid[] := public.blocked_products(p_products, p_access);
  v_allowed uuid[];
  v_own uuid := (select id from public.orders where token = p_own and status = 'pending');
  c jsonb;
begin
  if cardinality(v_blocked) = 0 then
    return public.order_calc(p_products, p_country, p_code, false, v_own);
  end if;
  select coalesce(array_agg(x), '{}'::uuid[]) into v_allowed from unnest(p_products) x where not (x = any (v_blocked));
  if cardinality(v_allowed) = 0 then
    return jsonb_build_object('items', '[]'::jsonb, 'unavailable', to_jsonb(v_blocked), 'subtotal_cents', 0,
      'discount_code', null, 'discount_error', null, 'discount_cents', 0, 'shipping_cents', null,
      'total_cents', 0, 'vat_mode', 'incl21', 'vat_cents', 0);
  end if;
  c := public.order_calc(v_allowed, p_country, p_code, false, v_own);
  if c ? 'error' then return c; end if;
  return c || jsonb_build_object('unavailable', (c -> 'unavailable') || to_jsonb(v_blocked));
end;
$$;

-- ---------------------------------------------------------------
-- 6. Alleen de server: drop ophalen met code, aanmelden, mails versturen
-- ---------------------------------------------------------------

-- Producten van een drop als JSON (zelfde gegevens als de gebouwde site gebruikt)
create or replace function public.early_access_products(p_drop uuid, p_only uuid[] default null)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id, 'code', p.code, 'slug', p.slug, 'category', p.category,
    'name_nl', p.name_nl, 'name_en', p.name_en,
    'description_nl', p.description_nl, 'description_en', p.description_en,
    'details_nl', p.details_nl, 'details_en', p.details_en,
    'button_story_nl', p.button_story_nl, 'button_story_en', p.button_story_en,
    'price_cents', p.price_cents,
    'size', (select v.size from public.product_variants v where v.product_id = p.id and v.size is not null and v.size <> 'one-size' limit 1),
    'available', exists (select 1 from public.product_variants v where v.product_id = p.id and v.status <> 'sold' and v.stock > 0),
    'images', coalesce((select jsonb_agg(jsonb_build_object('small', i.path_small, 'large', i.path_large, 'alt_nl', i.alt_nl, 'alt_en', i.alt_en) order by i.sort, i.created_at)
                        from public.product_images i where i.product_id = p.id), '[]'::jsonb)
  ) order by p.sort, p.created_at), '[]'::jsonb)
  from public.products p
  where p.drop_id = p_drop and p.published and (p_only is null or p.id = any (p_only));
$$;

-- De drop-pagina: 'none' (bestaat niet of is geheim), 'closed' (nog niet open zonder code), 'open' (met code) of 'public'
create or replace function public.early_access_drop(p_slug text, p_access text[] default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  d public.drops%rowtype;
  e public.drop_early_access%rowtype;
  v_state text;
begin
  select * into d from public.drops where slug = p_slug;
  if not found then return jsonb_build_object('state', 'none'); end if;
  select * into e from public.drop_early_access where drop_id = d.id;
  if public.drop_is_public(d.id) then
    v_state := 'public';
  elsif e.drop_id is null then
    return jsonb_build_object('state', 'none');
  elsif public.drop_access_ok(d.id, p_access) then
    v_state := 'open';
  else
    return jsonb_build_object('state', 'closed', 'public_start', e.public_start,
      'drop', jsonb_build_object('slug', d.slug, 'name_nl', d.name_nl, 'name_en', d.name_en));
  end if;
  return jsonb_build_object('state', v_state, 'public_start', e.public_start,
    'drop', jsonb_build_object('slug', d.slug, 'name_nl', d.name_nl, 'name_en', d.name_en, 'intro_nl', d.intro_nl, 'intro_en', d.intro_en),
    'products', public.early_access_products(d.id));
end;
$$;

-- Voor de winkelwagen: gegevens van producten die niet in de gebouwde site staan:
-- uit een drop waar je een geldige code voor hebt, of uit een drop die net publiek is (nog voordat de site opnieuw gebouwd is)
create or replace function public.early_access_items(p_products uuid[], p_access text[])
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x.item || jsonb_build_object('drop_slug', x.slug)), '[]'::jsonb)
  from (
    select d.slug, jsonb_array_elements(public.early_access_products(d.id, p_products)) as item
    from public.drops d
    where d.id in (select p.drop_id from public.products p where p.id = any (coalesce(p_products, '{}'::uuid[])))
      and (public.drop_is_public(d.id) or public.drop_access_ok(d.id, p_access))
  ) x;
$$;

-- Aanmelden via de pop-up. new = false als het adres al bekend was.
create or replace function public.early_access_signup(p_email text, p_lang text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_id uuid;
begin
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 200 then
    return jsonb_build_object('error', 'email');
  end if;
  insert into public.early_access_signups (email, lang) values (v_email, case when p_lang = 'en' then 'en' else 'nl' end)
  on conflict (email) do nothing returning id into v_id;
  return jsonb_build_object('ok', true, 'new', v_id is not null);
end;
$$;

-- Aanmelders die de mail van deze drop nog niet hebben gekregen
create or replace function public.early_access_recipients(p_drop uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('email', s.email, 'lang', s.lang) order by s.created_at), '[]'::jsonb)
  from public.early_access_signups s
  where not exists (select 1 from public.early_access_sends x where x.drop_id = p_drop and x.email = s.email);
$$;

create or replace function public.early_access_mark_sent(p_drop uuid, p_emails text[])
returns integer language sql security definer set search_path = public as $$
  with ins as (
    insert into public.early_access_sends (drop_id, email)
    select p_drop, unnest(p_emails) on conflict do nothing returning 1
  )
  select count(*)::integer from ins;
$$;

-- Gegevens voor de early access-mail (naam van de drop en de code)
create or replace function public.early_access_info(p_drop uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('slug', d.slug, 'name_nl', d.name_nl, 'name_en', d.name_en, 'code', e.code,
    'early_access_start', e.early_access_start, 'public_start', e.public_start)
  from public.drops d join public.drop_early_access e on e.drop_id = d.id
  where d.id = p_drop;
$$;

-- ---------------------------------------------------------------
-- 7. Rechten
-- ---------------------------------------------------------------
revoke execute on function public.drop_access_ok(uuid, text[]) from public, anon, authenticated;
revoke execute on function public.blocked_products(uuid[], text[]) from public, anon, authenticated;
revoke execute on function public.early_access_products(uuid, uuid[]) from public, anon, authenticated;
revoke execute on function public.early_access_drop(text, text[]) from public, anon, authenticated;
revoke execute on function public.early_access_items(uuid[], text[]) from public, anon, authenticated;
revoke execute on function public.early_access_signup(text, text) from public, anon, authenticated;
revoke execute on function public.early_access_recipients(uuid) from public, anon, authenticated;
revoke execute on function public.early_access_mark_sent(uuid, text[]) from public, anon, authenticated;
revoke execute on function public.early_access_info(uuid) from public, anon, authenticated;

-- drop_is_public wordt in de beveiligingsregels gebruikt, dus iedereen moet hem kunnen uitvoeren (hij verraadt alleen ja/nee)
grant execute on function public.drop_is_public(uuid) to anon, authenticated, service_role;
grant execute on function public.quote_order(uuid[], text, text, uuid, text[]) to anon, authenticated, service_role;
grant execute on function public.drop_access_ok(uuid, text[]), public.blocked_products(uuid[], text[]),
  public.early_access_products(uuid, uuid[]), public.early_access_drop(text, text[]), public.early_access_items(uuid[], text[]),
  public.early_access_signup(text, text), public.early_access_recipients(uuid), public.early_access_mark_sent(uuid, text[]),
  public.early_access_info(uuid)
  to service_role;
