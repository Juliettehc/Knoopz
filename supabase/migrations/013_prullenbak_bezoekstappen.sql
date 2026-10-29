-- KNOOPZ: prullenbak voor bestellingen en bezoekstappen (waar haken bezoekers af).
-- Uitvoeren in Supabase: SQL Editor -> + New query -> plakken -> Run. Opnieuw uitvoeren kan geen kwaad.

-- ---------------------------------------------------------------
-- 1. Prullenbak: een verwijderde bestelling krijgt een datum en blijft terug te zetten.
--    Definitief verwijderen kan alleen vanuit de prullenbak.
-- ---------------------------------------------------------------
alter table public.orders add column if not exists deleted_at timestamptz;
alter table public.orders add column if not exists deleted_by text;

grant delete on public.orders to authenticated;
drop policy if exists "bestellingen definitief verwijderen" on public.orders;
create policy "bestellingen definitief verwijderen" on public.orders for delete to authenticated
  using (public.is_admin() and deleted_at is not null);

-- Wordt een bestelling in de prullenbak alsnog betaald, dan komt hij vanzelf terug.
create or replace function public.order_restore_on_paid()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.status = 'paid' and old.status is distinct from 'paid' then
    new.deleted_at := null;
    new.deleted_by := null;
  end if;
  return new;
end $$;
drop trigger if exists order_restore_on_paid on public.orders;
create trigger order_restore_on_paid before update on public.orders for each row execute function public.order_restore_on_paid();

-- ---------------------------------------------------------------
-- 2. Bezoekstappen: alleen tellers per dag, geen gegevens over personen.
-- ---------------------------------------------------------------
create table if not exists public.visit_steps (
  day date not null,
  step text not null check (step in ('visit', 'product', 'cart', 'checkout', 'pay')),
  n integer not null default 0,
  primary key (day, step)
);

alter table public.visit_steps enable row level security;
revoke all on public.visit_steps from anon, authenticated;
grant select on public.visit_steps to authenticated;
drop policy if exists "bezoekstappen lezen" on public.visit_steps;
create policy "bezoekstappen lezen" on public.visit_steps for select to authenticated using (public.is_admin());

create or replace function public.track_step(p_step text)
returns void language sql security definer set search_path = public as $$
  insert into public.visit_steps (day, step, n)
  select (now() at time zone 'Europe/Amsterdam')::date, p_step, 1
  where p_step in ('visit', 'product', 'cart', 'checkout', 'pay')
  on conflict (day, step) do update set n = public.visit_steps.n + 1;
$$;

revoke execute on function public.track_step(text) from public;
grant execute on function public.track_step(text) to anon, authenticated;
