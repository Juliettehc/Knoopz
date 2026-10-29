-- KNOOPZ: per product tellen hoe vaak het bekeken en in de winkelwagen gelegd is.
-- Net als de bezoekstappen (013) alleen tellers per dag, geen gegevens over personen.
-- Uitvoeren in Supabase: SQL Editor -> + New query -> plakken -> Run. Opnieuw uitvoeren kan geen kwaad.

create table if not exists public.product_steps (
  day date not null,
  product_id uuid not null references public.products (id) on delete cascade,
  step text not null check (step in ('view', 'cart')),
  n integer not null default 0,
  primary key (day, product_id, step)
);

alter table public.product_steps enable row level security;
revoke all on public.product_steps from anon, authenticated;
grant select on public.product_steps to authenticated;
drop policy if exists "productweergaven lezen" on public.product_steps;
create policy "productweergaven lezen" on public.product_steps for select to authenticated using (public.is_admin());

-- Alleen bestaande, gepubliceerde producten tellen mee
create or replace function public.track_product(p_product uuid, p_step text)
returns void language sql security definer set search_path = public as $$
  insert into public.product_steps (day, product_id, step, n)
  select (now() at time zone 'Europe/Amsterdam')::date, p.id, p_step, 1
  from public.products p
  where p.id = p_product and p.published and p_step in ('view', 'cart')
  on conflict (day, product_id, step) do update set n = public.product_steps.n + 1;
$$;

revoke execute on function public.track_product(uuid, text) from public;
grant execute on function public.track_product(uuid, text) to anon, authenticated;
