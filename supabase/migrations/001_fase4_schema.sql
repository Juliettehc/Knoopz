-- KNOOPZ fase 4: database, beveiliging en foto-opslag
-- Uitvoeren in Supabase: SQL Editor -> New query -> plakken -> Run.
-- Dit script bevat GEEN geheimen en mag in de repository staan.

-- ---------------------------------------------------------------
-- 1. Admins en de controle "is deze gebruiker een admin?"
-- ---------------------------------------------------------------
create table if not exists public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  created_at timestamptz not null default now()
);

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

-- ---------------------------------------------------------------
-- 2. Tabellen
-- ---------------------------------------------------------------
create table if not exists public.drops (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]+$'),
  name_nl text not null,
  name_en text,
  intro_nl text,
  intro_en text,
  sort integer not null default 0,
  published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  slug text not null unique check (slug ~ '^[a-z0-9-]+$'),
  drop_id uuid references public.drops (id) on delete set null,
  category text not null default 'pet' check (category in ('pet', 'overhemd')),
  name_nl text not null,
  name_en text,
  description_nl text,
  description_en text,
  details_nl text,
  details_en text,
  button_story_nl text,
  button_story_en text,
  price_cents integer check (price_cents is null or price_cents >= 0),
  published boolean not null default false,
  sort integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Een pet heeft één variant ('one-size', voorraad 1). Overhemden krijgen later één variant per maat.
create table if not exists public.product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  size text not null default 'one-size',
  stock integer not null default 1 check (stock >= 0),
  status text not null default 'available' check (status in ('available', 'reserved', 'sold')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (product_id, size)
);

create table if not exists public.product_images (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  path_small text not null,
  path_large text not null,
  alt_nl text,
  alt_en text,
  sort integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.settings (
  id integer primary key default 1 check (id = 1),
  shipping_cents integer check (shipping_cents is null or shipping_cents >= 0),
  free_shipping_from_cents integer check (free_shipping_from_cents is null or free_shipping_from_cents >= 0),
  updated_at timestamptz not null default now()
);
insert into public.settings (id) values (1) on conflict (id) do nothing;

-- Elke klik op "Wijzigingen publiceren" in het beheer voegt hier een regel toe.
-- Een Database Webhook op deze tabel laat Cloudflare de site opnieuw bouwen.
create table if not exists public.publish_requests (
  id bigint generated always as identity primary key,
  requested_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

create index if not exists products_drop_idx on public.products (drop_id);
create index if not exists variants_product_idx on public.product_variants (product_id);
create index if not exists images_product_idx on public.product_images (product_id);

-- updated_at automatisch bijwerken
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists drops_touch on public.drops;
create trigger drops_touch before update on public.drops for each row execute function public.touch_updated_at();
drop trigger if exists products_touch on public.products;
create trigger products_touch before update on public.products for each row execute function public.touch_updated_at();
drop trigger if exists variants_touch on public.product_variants;
create trigger variants_touch before update on public.product_variants for each row execute function public.touch_updated_at();
drop trigger if exists settings_touch on public.settings;
create trigger settings_touch before update on public.settings for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------
-- 3. Beveiliging (Row Level Security)
--    Bezoekers: alleen zichtbare (published) gegevens lezen.
--    Admins: alles lezen en wijzigen.
-- ---------------------------------------------------------------
alter table public.admins enable row level security;
alter table public.drops enable row level security;
alter table public.products enable row level security;
alter table public.product_variants enable row level security;
alter table public.product_images enable row level security;
alter table public.settings enable row level security;
alter table public.publish_requests enable row level security;

grant usage on schema public to anon, authenticated;
grant select on public.drops, public.products, public.product_variants, public.product_images, public.settings to anon, authenticated;
grant insert, update, delete on public.drops, public.products, public.product_variants, public.product_images to authenticated;
grant update on public.settings to authenticated;
grant select on public.admins to authenticated;
grant select, insert on public.publish_requests to authenticated;
grant execute on function public.is_admin() to anon, authenticated;

drop policy if exists "admins lezen eigen regel" on public.admins;
create policy "admins lezen eigen regel" on public.admins
  for select to authenticated using (user_id = auth.uid() or public.is_admin());

drop policy if exists "drops lezen" on public.drops;
create policy "drops lezen" on public.drops
  for select using (published or public.is_admin());
drop policy if exists "drops beheren" on public.drops;
create policy "drops beheren" on public.drops
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "producten lezen" on public.products;
create policy "producten lezen" on public.products
  for select using (published or public.is_admin());
drop policy if exists "producten beheren" on public.products;
create policy "producten beheren" on public.products
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "varianten lezen" on public.product_variants;
create policy "varianten lezen" on public.product_variants
  for select using (
    public.is_admin()
    or exists (select 1 from public.products p where p.id = product_id and p.published)
  );
drop policy if exists "varianten beheren" on public.product_variants;
create policy "varianten beheren" on public.product_variants
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "fotos lezen" on public.product_images;
create policy "fotos lezen" on public.product_images
  for select using (
    public.is_admin()
    or exists (select 1 from public.products p where p.id = product_id and p.published)
  );
drop policy if exists "fotos beheren" on public.product_images;
create policy "fotos beheren" on public.product_images
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "instellingen lezen" on public.settings;
create policy "instellingen lezen" on public.settings for select using (true);
drop policy if exists "instellingen wijzigen" on public.settings;
create policy "instellingen wijzigen" on public.settings
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "publiceren" on public.publish_requests;
create policy "publiceren" on public.publish_requests
  for insert to authenticated with check (public.is_admin());
drop policy if exists "publiceren lezen" on public.publish_requests;
create policy "publiceren lezen" on public.publish_requests
  for select to authenticated using (public.is_admin());

-- ---------------------------------------------------------------
-- 4. Foto-opslag: openbaar te bekijken, alleen admins uploaden/verwijderen
-- ---------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-images', 'product-images', true, 5242880, array['image/jpeg', 'image/webp', 'image/png'])
on conflict (id) do nothing;

drop policy if exists "fotos uploaden" on storage.objects;
create policy "fotos uploaden" on storage.objects
  for insert to authenticated with check (bucket_id = 'product-images' and public.is_admin());
drop policy if exists "fotos wijzigen" on storage.objects;
create policy "fotos wijzigen" on storage.objects
  for update to authenticated using (bucket_id = 'product-images' and public.is_admin());
drop policy if exists "fotos verwijderen" on storage.objects;
create policy "fotos verwijderen" on storage.objects
  for delete to authenticated using (bucket_id = 'product-images' and public.is_admin());

-- ---------------------------------------------------------------
-- 5. Startgegevens: Drop 01 en drie duidelijk gemarkeerde testproducten
--    (verwijder of vervang de testproducten in het beheer)
-- ---------------------------------------------------------------
insert into public.drops (slug, name_nl, name_en, intro_nl, intro_en, sort, published)
values ('drop-01', 'Drop 01', 'Drop 01', '[Korte tekst over deze drop]', '[Short text about this drop]', 1, true)
on conflict (slug) do nothing;

with d as (select id from public.drops where slug = 'drop-01')
insert into public.products (code, slug, drop_id, name_nl, name_en, published, sort)
select v.code, v.slug, d.id, v.name_nl, v.name_en, true, v.sort
from d, (values
  ('TEST-001', 'test-pet-01', 'TEST Pet 01', 'TEST Cap 01', 1),
  ('TEST-002', 'test-pet-02', 'TEST Pet 02', 'TEST Cap 02', 2),
  ('TEST-003', 'test-pet-03', 'TEST Pet 03', 'TEST Cap 03', 3)
) as v(code, slug, name_nl, name_en, sort)
on conflict (code) do nothing;

insert into public.product_variants (product_id, size, stock, status)
select p.id, 'one-size',
  case when p.code = 'TEST-003' then 0 else 1 end,
  case when p.code = 'TEST-003' then 'sold' else 'available' end
from public.products p
where p.code in ('TEST-001', 'TEST-002', 'TEST-003')
on conflict (product_id, size) do nothing;
