-- KNOOPZ: bezoekstappen ook per uur tellen, zodat je in het Overzicht ziet hoe laat er de meeste actie is.
-- Net als 013 alleen tellers (per dag en uur), geen gegevens over personen.
-- Uitvoeren in Supabase: SQL Editor -> + New query -> plakken -> Run. Opnieuw uitvoeren kan geen kwaad.
-- Vereist migratie 013. Bestellingen en aanmeldingen hebben al een tijdstip en tellen meteen mee, ook van vóór deze migratie.

create table if not exists public.step_hours (
  day date not null,
  hour smallint not null check (hour between 0 and 23),
  step text not null check (step in ('visit', 'product', 'cart', 'checkout', 'pay')),
  n integer not null default 0,
  primary key (day, hour, step)
);

alter table public.step_hours enable row level security;
revoke all on public.step_hours from anon, authenticated;
grant select on public.step_hours to authenticated;
drop policy if exists "bezoek per uur lezen" on public.step_hours;
create policy "bezoek per uur lezen" on public.step_hours for select to authenticated using (public.is_admin());

-- Telt voortaan per dag én per uur (Nederlandse tijd)
create or replace function public.track_step(p_step text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_now timestamp := now() at time zone 'Europe/Amsterdam';
begin
  if p_step not in ('visit', 'product', 'cart', 'checkout', 'pay') then
    return;
  end if;
  insert into public.visit_steps (day, step, n)
  values (v_now::date, p_step, 1)
  on conflict (day, step) do update set n = public.visit_steps.n + 1;
  insert into public.step_hours (day, hour, step, n)
  values (v_now::date, extract(hour from v_now)::smallint, p_step, 1)
  on conflict (day, hour, step) do update set n = public.step_hours.n + 1;
end;
$$;

revoke execute on function public.track_step(text) from public;
grant execute on function public.track_step(text) to anon, authenticated;
