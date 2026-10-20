-- KNOOPZ fase 5: bestellingen, betalingen (Mollie), reservering en kortingscodes
-- Uitvoeren in Supabase: SQL Editor -> + New query -> plakken -> Run.
-- Dit script bevat GEEN geheimen en mag in de repository staan. Opnieuw uitvoeren kan geen kwaad.

-- ---------------------------------------------------------------
-- 1. Extra instellingen: verzendkosten België en btw
-- ---------------------------------------------------------------
alter table public.settings
  add column if not exists shipping_be_cents integer check (shipping_be_cents is null or shipping_be_cents >= 0);
alter table public.settings
  add column if not exists vat_mode text not null default 'incl21' check (vat_mode in ('incl21', 'kor'));

-- ---------------------------------------------------------------
-- 2. Tabellen
-- ---------------------------------------------------------------
create table if not exists public.discount_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z0-9_-]{3,30}$'),
  kind text not null check (kind in ('percent', 'amount')),
  value integer not null check (value > 0),
  min_order_cents integer check (min_order_cents is null or min_order_cents >= 0),
  max_uses integer check (max_uses is null or max_uses > 0),
  used_count integer not null default 0,
  ends_at timestamptz,
  active boolean not null default true,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (kind <> 'percent' or value <= 100)
);

create sequence if not exists public.order_number_seq start 1001;

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  number text not null unique default ('KNZ-' || nextval('public.order_number_seq')),
  token uuid not null unique default gen_random_uuid(),
  status text not null default 'pending' check (status in ('pending', 'paid', 'shipped', 'cancelled', 'expired', 'failed')),
  lang text not null default 'nl' check (lang in ('nl', 'en')),
  email text not null,
  first_name text not null,
  last_name text not null,
  street text not null,
  postal_code text not null,
  city text not null,
  country text not null check (country in ('NL', 'BE')),
  subtotal_cents integer not null,
  discount_cents integer not null default 0,
  discount_code text,
  shipping_cents integer not null,
  total_cents integer not null,
  vat_mode text not null,
  vat_cents integer not null default 0,
  reserved_until timestamptz not null,
  mollie_payment_id text unique,
  payment_method text,
  paid_at timestamptz,
  shipped_at timestamptz,
  tracking_url text,
  needs_attention text,
  confirmation_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  product_id uuid references public.products (id) on delete set null,
  variant_id uuid references public.product_variants (id) on delete set null,
  code text not null,
  name text not null,
  size text,
  price_cents integer not null
);

create index if not exists orders_status_idx on public.orders (status, created_at desc);
create index if not exists order_items_order_idx on public.order_items (order_id);
create index if not exists order_items_variant_idx on public.order_items (variant_id);

drop trigger if exists orders_touch on public.orders;
create trigger orders_touch before update on public.orders for each row execute function public.touch_updated_at();
drop trigger if exists discount_touch on public.discount_codes;
create trigger discount_touch before update on public.discount_codes for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------
-- 3. Beveiliging: alleen admins zien bestellingen en kortingscodes.
--    Bezoekers hebben geen enkele toegang tot deze tabellen.
-- ---------------------------------------------------------------
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.discount_codes enable row level security;

revoke all on public.orders, public.order_items, public.discount_codes from anon;
grant select, update on public.orders to authenticated;
grant select on public.order_items to authenticated;
grant select, insert, update, delete on public.discount_codes to authenticated;

drop policy if exists "bestellingen lezen" on public.orders;
create policy "bestellingen lezen" on public.orders for select to authenticated using (public.is_admin());
drop policy if exists "bestellingen wijzigen" on public.orders;
create policy "bestellingen wijzigen" on public.orders for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "bestelregels lezen" on public.order_items;
create policy "bestelregels lezen" on public.order_items for select to authenticated using (public.is_admin());
drop policy if exists "kortingscodes beheren" on public.discount_codes;
create policy "kortingscodes beheren" on public.discount_codes for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------
-- 4. Logica: reservering, berekenen, bestelling aanmaken, betaling verwerken
-- ---------------------------------------------------------------

-- Is deze variant gereserveerd door een openstaande bestelling (afrekenen bezig, max. 15 minuten)?
create or replace function public.variant_is_reserved(p_variant uuid, p_except uuid default null)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.order_items i join public.orders o on o.id = i.order_id
    where i.variant_id = p_variant and o.status = 'pending' and o.reserved_until > now()
      and o.id is distinct from p_except
  );
$$;

-- Berekent artikelen, korting, verzendkosten, totaal en btw. Prijzen komen altijd uit de database.
create or replace function public.order_calc(p_products uuid[], p_country text, p_code text, p_lock boolean, p_except uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  s public.settings%rowtype;
  d public.discount_codes%rowtype;
  r record;
  v_items jsonb := '[]'::jsonb;
  v_unavailable jsonb := '[]'::jsonb;
  v_sub integer := 0;
  v_disc integer := 0;
  v_ship integer;
  v_total integer;
  v_code text := nullif(upper(btrim(coalesce(p_code, ''))), '');
  v_disc_error text;
begin
  if p_products is null or cardinality(p_products) = 0 then
    return jsonb_build_object('error', 'empty');
  end if;
  if cardinality(p_products) > 20 then
    return jsonb_build_object('error', 'too_many');
  end if;
  if coalesce(p_country, '') not in ('NL', 'BE') then
    return jsonb_build_object('error', 'country');
  end if;

  select * into s from public.settings where id = 1;

  if p_lock then
    -- vergrendelen zodat twee klanten niet tegelijk hetzelfde unieke stuk kunnen reserveren
    perform 1 from public.product_variants where product_id = any (p_products) order by id for update;
  end if;

  for r in
    select x.id as req_id, p.id as product_id, p.code, p.slug, p.name_nl, p.name_en, p.price_cents, p.published,
           v.id as variant_id, v.size, v.status, v.stock,
           (select im.path_small from public.product_images im where im.product_id = p.id order by im.sort, im.created_at limit 1) as img
    from (select distinct unnest(p_products) as id) x
    left join public.products p on p.id = x.id
    left join lateral (
      select pv.* from public.product_variants pv where pv.product_id = p.id
      order by (pv.status = 'available' and pv.stock > 0) desc, pv.created_at limit 1
    ) v on true
  loop
    if r.product_id is null or not r.published or r.price_cents is null or r.variant_id is null
       or r.status <> 'available' or r.stock < 1 or public.variant_is_reserved(r.variant_id, p_except) then
      v_unavailable := v_unavailable || to_jsonb(r.req_id);
    else
      v_items := v_items || jsonb_build_object(
        'product_id', r.product_id, 'variant_id', r.variant_id, 'code', r.code, 'slug', r.slug,
        'name_nl', r.name_nl, 'name_en', coalesce(r.name_en, r.name_nl), 'size', r.size,
        'price_cents', r.price_cents, 'img', r.img);
      v_sub := v_sub + r.price_cents;
    end if;
  end loop;

  if v_code is not null then
    select * into d from public.discount_codes where code = v_code;
    if not found or not d.active then v_disc_error := 'invalid';
    elsif d.ends_at is not null and d.ends_at < now() then v_disc_error := 'expired';
    elsif d.max_uses is not null and d.used_count >= d.max_uses then v_disc_error := 'used_up';
    elsif d.min_order_cents is not null and v_sub < d.min_order_cents then v_disc_error := 'min_order';
    else
      v_disc := case when d.kind = 'percent' then round(v_sub * d.value / 100.0)::integer else least(d.value, v_sub) end;
    end if;
  end if;

  v_ship := case when p_country = 'BE' then coalesce(s.shipping_be_cents, s.shipping_cents) else s.shipping_cents end;
  if v_ship is not null and s.free_shipping_from_cents is not null and (v_sub - v_disc) >= s.free_shipping_from_cents then
    v_ship := 0;
  end if;
  v_total := v_sub - v_disc + coalesce(v_ship, 0);

  return jsonb_build_object(
    'items', v_items,
    'unavailable', v_unavailable,
    'subtotal_cents', v_sub,
    'discount_code', case when v_code is not null and v_disc_error is null then v_code end,
    'discount_error', v_disc_error,
    'discount_cents', v_disc,
    'shipping_cents', v_ship,
    'total_cents', v_total,
    'vat_mode', s.vat_mode,
    'vat_cents', case when s.vat_mode = 'incl21' then round(v_total * 21 / 121.0)::integer else 0 end
  );
end;
$$;

-- Openbaar: berekening voor de afrekenpagina (verandert niets).
-- p_own: token van de eigen openstaande bestelling (terug van de betaalpagina); die reservering telt niet mee.
create or replace function public.quote_order(p_products uuid[], p_country text default 'NL', p_code text default null, p_own uuid default null)
returns jsonb language sql stable security definer set search_path = public as $$
  select public.order_calc(p_products, p_country, p_code, false,
    (select id from public.orders where token = p_own and status = 'pending'));
$$;

-- Alleen de server: bestelling aanmaken en de stukken 15 minuten reserveren.
create or replace function public.create_order(p_products uuid[], p_customer jsonb, p_code text, p_lang text, p_replace uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c jsonb;
  o public.orders%rowtype;
  v_email text := lower(btrim(coalesce(p_customer ->> 'email', '')));
  v_first text := btrim(coalesce(p_customer ->> 'first_name', ''));
  v_last text := btrim(coalesce(p_customer ->> 'last_name', ''));
  v_street text := btrim(coalesce(p_customer ->> 'street', ''));
  v_postal text := upper(btrim(coalesce(p_customer ->> 'postal_code', '')));
  v_city text := btrim(coalesce(p_customer ->> 'city', ''));
  v_country text := upper(btrim(coalesce(p_customer ->> 'country', '')));
begin
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 200
     or v_first = '' or v_last = '' or v_street = '' or v_city = '' or v_postal = ''
     or length(v_first) > 100 or length(v_last) > 100 or length(v_street) > 200 or length(v_city) > 100
     or (v_country = 'NL' and v_postal !~ '^[0-9]{4} ?[A-Z]{2}$')
     or (v_country = 'BE' and v_postal !~ '^[0-9]{4}$') then
    return jsonb_build_object('error', 'customer');
  end if;

  -- Eigen eerdere, nog openstaande bestelling (bijv. terug van de betaalpagina) vervalt: deze vervangt hem.
  if p_replace is not null then
    update public.orders set status = 'cancelled' where token = p_replace and status = 'pending';
  end if;

  c := public.order_calc(p_products, v_country, p_code, true);
  if c ? 'error' then return c; end if;
  if jsonb_array_length(c -> 'unavailable') > 0 then
    return jsonb_build_object('error', 'unavailable', 'unavailable', c -> 'unavailable');
  end if;
  if jsonb_array_length(c -> 'items') = 0 then return jsonb_build_object('error', 'empty'); end if;
  if c ->> 'discount_error' is not null then
    return jsonb_build_object('error', 'discount', 'reason', c ->> 'discount_error');
  end if;
  if c -> 'shipping_cents' = 'null'::jsonb then return jsonb_build_object('error', 'shipping_not_set'); end if;

  insert into public.orders (lang, email, first_name, last_name, street, postal_code, city, country,
    subtotal_cents, discount_cents, discount_code, shipping_cents, total_cents, vat_mode, vat_cents, reserved_until)
  values (case when p_lang = 'en' then 'en' else 'nl' end, v_email, v_first, v_last, v_street,
    case when v_country = 'NL' then regexp_replace(v_postal, '^([0-9]{4}) ?([A-Z]{2})$', '\1 \2') else v_postal end,
    v_city, v_country,
    (c ->> 'subtotal_cents')::int, (c ->> 'discount_cents')::int, c ->> 'discount_code', (c ->> 'shipping_cents')::int,
    (c ->> 'total_cents')::int, c ->> 'vat_mode', (c ->> 'vat_cents')::int, now() + interval '15 minutes')
  returning * into o;

  insert into public.order_items (order_id, product_id, variant_id, code, name, size, price_cents)
  select o.id, (i ->> 'product_id')::uuid, (i ->> 'variant_id')::uuid, i ->> 'code',
         case when o.lang = 'en' then i ->> 'name_en' else i ->> 'name_nl' end, i ->> 'size', (i ->> 'price_cents')::int
  from jsonb_array_elements(c -> 'items') i;

  return jsonb_build_object('order_id', o.id, 'number', o.number, 'token', o.token, 'total_cents', o.total_cents, 'lang', o.lang);
end;
$$;

-- Alleen de server: Mollie-betaling koppelen aan de bestelling.
create or replace function public.attach_payment(p_order uuid, p_payment text)
returns boolean language sql security definer set search_path = public as $$
  update public.orders set mollie_payment_id = p_payment
  where id = p_order and status = 'pending' and mollie_payment_id is null
  returning true;
$$;

-- Alleen de server: reservering vrijgeven als de betaling niet gestart kon worden.
create or replace function public.cancel_unpaid_order(p_order uuid)
returns boolean language sql security definer set search_path = public as $$
  update public.orders set status = 'cancelled'
  where id = p_order and status = 'pending' and mollie_payment_id is null
  returning true;
$$;

-- Alleen de server: betaalstatus van Mollie verwerken.
create or replace function public.apply_payment_status(p_order uuid, p_payment text, p_status text, p_method text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  o public.orders%rowtype;
  v_conflict boolean;
begin
  select * into o from public.orders where id = p_order for update;
  if not found or o.mollie_payment_id is distinct from p_payment then
    return jsonb_build_object('error', 'mismatch');
  end if;

  if p_status = 'paid' then
    if o.status in ('paid', 'shipped') then
      return jsonb_build_object('changed', false, 'status', o.status);
    end if;
    perform 1 from public.product_variants v
      where v.id in (select variant_id from public.order_items where order_id = o.id) for update;
    select exists (
      select 1 from public.order_items i left join public.product_variants v on v.id = i.variant_id
      where i.order_id = o.id
        and (v.id is null or v.status = 'sold' or v.stock < 1 or public.variant_is_reserved(v.id, o.id))
    ) into v_conflict;

    if not v_conflict then
      update public.product_variants set status = 'sold', stock = 0
      where id in (select variant_id from public.order_items where order_id = o.id);
    end if;
    update public.orders set status = 'paid', paid_at = now(), payment_method = p_method,
      needs_attention = case when v_conflict then
        'Betaald nadat de reservering was verlopen, en een artikel was intussen verkocht of gereserveerd. Neem contact op met de klant en betaal zo nodig terug via Mollie.'
      end
    where id = o.id;
    if o.discount_code is not null then
      update public.discount_codes set used_count = used_count + 1 where code = o.discount_code;
    end if;
    return jsonb_build_object('changed', true, 'status', 'paid', 'conflict', v_conflict);
  end if;

  if p_status in ('canceled', 'expired', 'failed') then
    if o.status = 'pending' then
      update public.orders set status = case p_status when 'canceled' then 'cancelled' else p_status end where id = o.id;
      return jsonb_build_object('changed', true, 'status', case p_status when 'canceled' then 'cancelled' else p_status end);
    end if;
  end if;
  return jsonb_build_object('changed', false, 'status', o.status);
end;
$$;

-- Alleen de server: bestelling ophalen (voor bedankpagina en e-mails).
create or replace function public.order_by_token(p_token uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select to_jsonb(o) || jsonb_build_object('items', coalesce((
    select jsonb_agg(jsonb_build_object('code', i.code, 'name', i.name, 'size', i.size, 'price_cents', i.price_cents) order by i.code)
    from public.order_items i where i.order_id = o.id), '[]'::jsonb))
  from public.orders o where o.token = p_token;
$$;

create or replace function public.order_by_id(p_order uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select public.order_by_token(token) from public.orders where id = p_order;
$$;

-- Alleen de server: bestelling op verzonden zetten.
create or replace function public.mark_order_shipped(p_order uuid, p_tracking text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o public.orders%rowtype;
begin
  update public.orders set status = 'shipped', shipped_at = now(), tracking_url = nullif(btrim(coalesce(p_tracking, '')), '')
  where id = p_order and status in ('paid', 'shipped') returning * into o;
  if not found then return jsonb_build_object('error', 'not_paid'); end if;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.mark_confirmation_sent(p_order uuid)
returns boolean language sql security definer set search_path = public as $$
  update public.orders set confirmation_sent_at = now() where id = p_order and confirmation_sent_at is null returning true;
$$;

create or replace function public.admin_emails()
returns text[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(email order by created_at), '{}') from public.admins;
$$;

-- Admin-controle met het token van de ingelogde gebruiker (voor de serverfunctie "Verzonden")
-- gebeurt met de bestaande functie public.is_admin().

-- Rechten: functies zijn standaard voor iedereen uitvoerbaar; dat zetten we hier dicht.
revoke execute on function public.variant_is_reserved(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.order_calc(uuid[], text, text, boolean, uuid) from public, anon, authenticated;
revoke execute on function public.create_order(uuid[], jsonb, text, text, uuid) from public, anon, authenticated;
revoke execute on function public.attach_payment(uuid, text) from public, anon, authenticated;
revoke execute on function public.apply_payment_status(uuid, text, text, text) from public, anon, authenticated;
revoke execute on function public.cancel_unpaid_order(uuid) from public, anon, authenticated;
revoke execute on function public.order_by_token(uuid) from public, anon, authenticated;
revoke execute on function public.order_by_id(uuid) from public, anon, authenticated;
revoke execute on function public.mark_order_shipped(uuid, text) from public, anon, authenticated;
revoke execute on function public.mark_confirmation_sent(uuid) from public, anon, authenticated;
revoke execute on function public.admin_emails() from public, anon, authenticated;

grant execute on function public.quote_order(uuid[], text, text, uuid) to anon, authenticated;
grant execute on function public.variant_is_reserved(uuid, uuid), public.order_calc(uuid[], text, text, boolean, uuid),
  public.create_order(uuid[], jsonb, text, text, uuid), public.attach_payment(uuid, text),
  public.apply_payment_status(uuid, text, text, text), public.cancel_unpaid_order(uuid), public.order_by_token(uuid), public.order_by_id(uuid),
  public.mark_order_shipped(uuid, text), public.mark_confirmation_sent(uuid), public.admin_emails()
  to service_role;
