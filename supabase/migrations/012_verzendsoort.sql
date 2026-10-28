-- KNOOPZ: verzendsoort per product: PostNL-pakket of brievenbuspakje.
-- Petten gaan standaard als pakket, overhemden als brievenbuspakje. Per product aan te passen in het beheer.
-- Uitvoeren in Supabase: SQL Editor -> + New query -> plakken -> Run. Opnieuw uitvoeren kan geen kwaad.

do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'products' and column_name = 'parcel_type') then
    alter table public.products add column parcel_type text not null default 'package' check (parcel_type in ('package', 'mailbox'));
    -- alleen de eerste keer: bestaande overhemden worden brievenbuspakje
    update public.products set parcel_type = 'mailbox' where category = 'overhemd';
  end if;
end $$;

-- Welke soort is er voor het label gebruikt
alter table public.orders add column if not exists parcel_type text check (parcel_type is null or parcel_type in ('package', 'mailbox'));

-- Verzendsoort van een bestelling: brievenbuspakje alleen als ALLE artikelen in de brievenbus passen
create or replace function public.order_parcel_type(p_order uuid)
returns text language sql stable security definer set search_path = public as $$
  select case when count(*) > 0 and bool_and(p.parcel_type = 'mailbox') then 'mailbox' else 'package' end
  from public.order_items i left join public.products p on p.id = i.product_id
  where i.order_id = p_order;
$$;

create or replace function public.set_order_parcel_type(p_order uuid, p_type text)
returns boolean language sql security definer set search_path = public as $$
  update public.orders set parcel_type = p_type where id = p_order and p_type in ('package', 'mailbox') returning true;
$$;

revoke execute on function public.order_parcel_type(uuid) from public, anon, authenticated;
revoke execute on function public.set_order_parcel_type(uuid, text) from public, anon, authenticated;
grant execute on function public.order_parcel_type(uuid), public.set_order_parcel_type(uuid, text) to service_role;
