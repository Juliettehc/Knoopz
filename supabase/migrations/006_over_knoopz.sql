-- KNOOPZ: tekst en foto's voor de pagina Over KNOOPZ, te beheren in het beheer onder "Over KNOOPZ".
-- Gebruikt dezelfde tabellen als de homepage (site_texts en site_images); hier worden alleen de toegestane namen uitgebreid.
-- Uitvoeren in Supabase: SQL Editor -> + New query -> plakken -> Run. Opnieuw uitvoeren kan geen kwaad.

alter table public.site_images drop constraint if exists site_images_key_check;
alter table public.site_images add constraint site_images_key_check check (key in (
  'hero_desktop', 'hero_mobile', 'story', 'insta_1', 'insta_2', 'insta_3', 'insta_4', 'insta_5', 'insta_6',
  'about_hero', 'about_1', 'about_2', 'about_3'
));

alter table public.site_texts drop constraint if exists site_texts_key_check;
alter table public.site_texts add constraint site_texts_key_check check (key in (
  'hero_title', 'story_title', 'story_text', 'insta_title',
  'about_title', 'about_intro', 'about_1_title', 'about_1_text', 'about_2_title', 'about_2_text', 'about_3_title', 'about_3_text'
));
