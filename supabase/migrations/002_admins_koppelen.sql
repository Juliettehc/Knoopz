-- KNOOPZ: de drie oprichters als admin aanmerken.
-- Eerst in Supabase: Authentication -> Users -> Invite user (voor elk van de drie).
-- Vervang daarna hieronder de drie e-mailadressen en voer dit uit in de SQL Editor.

insert into public.admins (user_id, email)
select id, email
from auth.users
where lower(email) in (
  lower('[e-mailadres oprichter 1]'),
  lower('[e-mailadres oprichter 2]'),
  lower('[e-mailadres oprichter 3]')
)
on conflict (user_id) do nothing;

-- Controle: deze lijst moet drie regels tonen.
select email, created_at from public.admins order by created_at;
