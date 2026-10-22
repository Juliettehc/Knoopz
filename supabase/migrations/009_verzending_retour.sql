-- KNOOPZ: teksten voor de pagina Verzending en retour (en de korte verzendinfo op de productpagina).
-- Vanaf nu mogen teksten elke eenvoudige naam hebben, zodat er voor nieuwe pagina's geen extra script meer nodig is.
-- Uitvoeren in Supabase: SQL Editor -> + New query -> plakken -> Run. Opnieuw uitvoeren kan geen kwaad.

alter table public.site_texts drop constraint if exists site_texts_key_check;
alter table public.site_texts add constraint site_texts_key_check check (key ~ '^[a-z0-9_]{2,40}$');
