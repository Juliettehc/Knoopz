-- KNOOPZ: foto's voor de homepage (campagnefoto, verhaalfoto, Instagram-tegels), te beheren in het beheer.
-- Uitvoeren in Supabase: SQL Editor -> + New query -> plakken -> Run. Opnieuw uitvoeren kan geen kwaad.

create table if not exists public.site_images (
  key text primary key check (key in ('hero_desktop', 'hero_mobile', 'story', 'insta_1', 'insta_2', 'insta_3', 'insta_4', 'insta_5', 'insta_6')),
  path text not null,
  alt_nl text,
  alt_en text,
  link text,
  updated_at timestamptz not null default now()
);

drop trigger if exists site_images_touch on public.site_images;
create trigger site_images_touch before update on public.site_images for each row execute function public.touch_updated_at();

alter table public.site_images enable row level security;
grant select on public.site_images to anon, authenticated;
grant insert, update, delete on public.site_images to authenticated;

drop policy if exists "homepagefotos lezen" on public.site_images;
create policy "homepagefotos lezen" on public.site_images for select using (true);
drop policy if exists "homepagefotos beheren" on public.site_images;
create policy "homepagefotos beheren" on public.site_images
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
