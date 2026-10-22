-- KNOOPZ: veelgestelde vragen (FAQ), te beheren in het beheer onder "FAQ".
-- Uitvoeren in Supabase: SQL Editor -> + New query -> plakken -> Run. Opnieuw uitvoeren kan geen kwaad.

create table if not exists public.faq_items (
  id uuid primary key default gen_random_uuid(),
  question_nl text not null,
  answer_nl text not null,
  question_en text,
  answer_en text,
  sort integer not null default 0,
  published boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists faq_touch on public.faq_items;
create trigger faq_touch before update on public.faq_items for each row execute function public.touch_updated_at();

alter table public.faq_items enable row level security;
grant select on public.faq_items to anon, authenticated;
grant insert, update, delete on public.faq_items to authenticated;

drop policy if exists "faq lezen" on public.faq_items;
create policy "faq lezen" on public.faq_items for select using (published or public.is_admin());
drop policy if exists "faq beheren" on public.faq_items;
create policy "faq beheren" on public.faq_items
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
