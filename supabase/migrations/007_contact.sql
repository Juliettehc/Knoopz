-- KNOOPZ: contactpagina (teksten en bedrijfsgegevens in het beheer) en berichten via het contactformulier.
-- Uitvoeren in Supabase: SQL Editor -> + New query -> plakken -> Run. Opnieuw uitvoeren kan geen kwaad.

-- 1. Extra teksten voor de contactpagina
alter table public.site_texts drop constraint if exists site_texts_key_check;
alter table public.site_texts add constraint site_texts_key_check check (key in (
  'hero_title', 'story_title', 'story_text', 'insta_title',
  'about_title', 'about_intro', 'about_1_title', 'about_1_text', 'about_2_title', 'about_2_text', 'about_3_title', 'about_3_text',
  'contact_title', 'contact_intro', 'contact_email', 'contact_company', 'contact_kvk', 'contact_vat', 'contact_address'
));

-- 2. Berichten via het contactformulier (alleen zichtbaar voor beheerders)
create table if not exists public.contact_messages (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  message text not null,
  lang text not null default 'nl',
  handled boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists contact_messages_created_idx on public.contact_messages (created_at desc);

alter table public.contact_messages enable row level security;
revoke all on public.contact_messages from anon;
grant select, update, delete on public.contact_messages to authenticated;

drop policy if exists "berichten lezen" on public.contact_messages;
create policy "berichten lezen" on public.contact_messages for select to authenticated using (public.is_admin());
drop policy if exists "berichten wijzigen" on public.contact_messages;
create policy "berichten wijzigen" on public.contact_messages for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "berichten verwijderen" on public.contact_messages;
create policy "berichten verwijderen" on public.contact_messages for delete to authenticated using (public.is_admin());

-- 3. Alleen de server: bericht opslaan (met controle en een eenvoudige limiet tegen spam)
create or replace function public.submit_contact(p_name text, p_email text, p_message text, p_lang text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_msg text := btrim(coalesce(p_message, ''));
begin
  if v_name = '' or length(v_name) > 100 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 200
     or length(v_msg) < 5 or length(v_msg) > 5000 then
    return jsonb_build_object('error', 'invalid');
  end if;
  if (select count(*) from public.contact_messages where email = v_email and created_at > now() - interval '1 hour') >= 3
     or (select count(*) from public.contact_messages where created_at > now() - interval '1 minute') >= 10 then
    return jsonb_build_object('error', 'too_many');
  end if;
  insert into public.contact_messages (name, email, message, lang)
  values (v_name, v_email, v_msg, case when p_lang = 'en' then 'en' else 'nl' end);
  return jsonb_build_object('ok', true);
end;
$$;

revoke execute on function public.submit_contact(text, text, text, text) from public, anon, authenticated;
grant execute on function public.submit_contact(text, text, text, text) to service_role;
