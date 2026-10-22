-- KNOOPZ: eigen foto per drop (getoond in het Shop-menu), te beheren in het beheer bij Drops.
-- Uitvoeren in Supabase: SQL Editor -> + New query -> plakken -> Run. Opnieuw uitvoeren kan geen kwaad.

alter table public.drops add column if not exists image_path text;
