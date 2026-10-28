-- KNOOPZ: PostNL-verzendlabels, track & trace, status "bezorgd" en aanpasbare e-mailteksten.
-- Uitvoeren in Supabase: SQL Editor -> + New query -> plakken -> Run. Opnieuw uitvoeren kan geen kwaad.
-- Dit script bevat GEEN geheimen. De PostNL API-sleutel staat alleen in Cloudflare (POSTNL_API_KEY).

-- ---------------------------------------------------------------
-- 1. Bestellingen: PostNL-barcode, bezorgd
-- ---------------------------------------------------------------
alter table public.orders add column if not exists postnl_barcode text;
alter table public.orders add column if not exists delivered_at timestamptz;
alter table public.orders add column if not exists tracked_at timestamptz;

alter table public.orders drop constraint if exists orders_status_check;
alter table public.orders add constraint orders_status_check
  check (status in ('pending', 'paid', 'shipped', 'delivered', 'cancelled', 'expired', 'failed'));

-- Het verzendlabel (PDF) zelf, zodat jullie het later opnieuw kunnen downloaden
create table if not exists public.shipping_labels (
  order_id uuid primary key references public.orders (id) on delete cascade,
  barcode text not null,
  pdf_base64 text not null,
  created_at timestamptz not null default now()
);

-- Afzenderadres voor op het label (alleen zichtbaar voor beheerders)
create table if not exists public.shipping_sender (
  id integer primary key default 1 check (id = 1),
  company text,
  street text,
  house_nr text,
  house_nr_ext text,
  postal_code text,
  city text,
  weight_grams integer not null default 1000 check (weight_grams between 1 and 31500),
  updated_at timestamptz not null default now()
);
insert into public.shipping_sender (id) values (1) on conflict (id) do nothing;

-- Eigen e-mailteksten (leeg = standaardtekst)
create table if not exists public.email_templates (
  key text not null check (key in ('confirmation', 'shipped', 'admin_new', 'footer')),
  lang text not null check (lang in ('nl', 'en')),
  subject text,
  heading text,
  body text,
  button text,
  updated_at timestamptz not null default now(),
  primary key (key, lang)
);

drop trigger if exists shipping_sender_touch on public.shipping_sender;
create trigger shipping_sender_touch before update on public.shipping_sender for each row execute function public.touch_updated_at();
drop trigger if exists email_templates_touch on public.email_templates;
create trigger email_templates_touch before update on public.email_templates for each row execute function public.touch_updated_at();

alter table public.shipping_labels enable row level security;
alter table public.shipping_sender enable row level security;
alter table public.email_templates enable row level security;

revoke all on public.shipping_labels, public.shipping_sender, public.email_templates from anon;
grant select on public.shipping_labels to authenticated;
grant select, update on public.shipping_sender to authenticated;
grant select, insert, update, delete on public.email_templates to authenticated;

drop policy if exists "labels lezen" on public.shipping_labels;
create policy "labels lezen" on public.shipping_labels for select to authenticated using (public.is_admin());
drop policy if exists "afzender beheren" on public.shipping_sender;
create policy "afzender beheren" on public.shipping_sender for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "e-mailteksten beheren" on public.email_templates;
create policy "e-mailteksten beheren" on public.email_templates for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------
-- 2. Betaalstatus: een bezorgde bestelling telt ook als betaald
-- ---------------------------------------------------------------
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
    if o.status in ('paid', 'shipped', 'delivered') then
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

-- ---------------------------------------------------------------
-- 3. Functies voor de server
-- ---------------------------------------------------------------

-- Label is aangemaakt bij PostNL: opslaan en de bestelling op "verzonden" zetten.
create or replace function public.save_label(p_order uuid, p_barcode text, p_tracking text, p_pdf text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o public.orders%rowtype;
begin
  update public.orders set status = 'shipped', shipped_at = coalesce(shipped_at, now()),
    postnl_barcode = p_barcode, tracking_url = p_tracking, delivered_at = null
  where id = p_order and status in ('paid', 'shipped') returning * into o;
  if not found then return jsonb_build_object('error', 'not_paid'); end if;
  insert into public.shipping_labels (order_id, barcode, pdf_base64) values (p_order, p_barcode, p_pdf)
  on conflict (order_id) do update set barcode = excluded.barcode, pdf_base64 = excluded.pdf_base64, created_at = now();
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.label_for_order(p_order uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('barcode', barcode, 'pdf_base64', pdf_base64) from public.shipping_labels where order_id = p_order;
$$;

create or replace function public.shipping_sender_get()
returns jsonb language sql stable security definer set search_path = public as $$
  select to_jsonb(s) from public.shipping_sender s where id = 1;
$$;

-- Verzonden pakketten waarvan we de bezorgstatus nog moeten navragen (oudste controle eerst)
create or replace function public.orders_to_track(p_limit integer default 25)
returns jsonb language sql security definer set search_path = public as $$
  with picked as (
    select id from public.orders
    where status = 'shipped' and postnl_barcode is not null and shipped_at > now() - interval '60 days'
    order by tracked_at nulls first limit greatest(1, least(p_limit, 50))
  ), touched as (
    update public.orders o set tracked_at = now() from picked where o.id = picked.id
    returning o.id, o.postnl_barcode, o.postal_code, o.country
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'barcode', postnl_barcode, 'postal_code', postal_code, 'country', country)), '[]'::jsonb)
  from touched;
$$;

create or replace function public.mark_delivered(p_order uuid, p_at timestamptz default null)
returns boolean language sql security definer set search_path = public as $$
  update public.orders set status = 'delivered', delivered_at = coalesce(p_at, now())
  where id = p_order and status = 'shipped' returning true;
$$;

create or replace function public.email_templates_all()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_object_agg(key, langs), '{}'::jsonb) from (
    select key, jsonb_object_agg(lang, jsonb_strip_nulls(jsonb_build_object('subject', subject, 'heading', heading, 'body', body, 'button', button))) as langs
    from public.email_templates group by key
  ) t;
$$;

revoke execute on function public.save_label(uuid, text, text, text) from public, anon, authenticated;
revoke execute on function public.label_for_order(uuid) from public, anon, authenticated;
revoke execute on function public.shipping_sender_get() from public, anon, authenticated;
revoke execute on function public.orders_to_track(integer) from public, anon, authenticated;
revoke execute on function public.mark_delivered(uuid, timestamptz) from public, anon, authenticated;
revoke execute on function public.email_templates_all() from public, anon, authenticated;

grant execute on function public.save_label(uuid, text, text, text), public.label_for_order(uuid), public.shipping_sender_get(),
  public.orders_to_track(integer), public.mark_delivered(uuid, timestamptz), public.email_templates_all()
  to service_role;
