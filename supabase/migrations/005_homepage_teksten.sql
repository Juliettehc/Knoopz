-- KNOOPZ: teksten op de homepage (titels en verhaal), te beheren in het beheer onder "Homepage".
-- Uitvoeren in Supabase: SQL Editor -> + New query -> plakken -> Run. Opnieuw uitvoeren kan geen kwaad.

create table if not exists public.site_texts (
  key text primary key check (key in ('hero_title', 'story_title', 'story_text', 'insta_title')),
  nl text,
  en text,
  updated_at timestamptz not null default now()
);

drop trigger if exists site_texts_touch on public.site_texts;
create trigger site_texts_touch before update on public.site_texts for each row execute function public.touch_updated_at();

alter table public.site_texts enable row level security;
grant select on public.site_texts to anon, authenticated;
grant insert, update, delete on public.site_texts to authenticated;

drop policy if exists "homepageteksten lezen" on public.site_texts;
create policy "homepageteksten lezen" on public.site_texts for select using (true);
drop policy if exists "homepageteksten beheren" on public.site_texts;
create policy "homepageteksten beheren" on public.site_texts
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
