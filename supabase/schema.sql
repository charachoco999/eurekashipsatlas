-- Atlas de progresión online · Supabase SQL
-- Ejecuta TODO este archivo en Supabase > SQL Editor > New query.

create table if not exists public.atlas_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (username ~ '^[a-z0-9_]{3,20}$'),
  created_at timestamptz not null default now()
);

create table if not exists public.atlas_progress (
  user_id uuid primary key references auth.users(id) on delete cascade,
  tree_done jsonb not null default '{}'::jsonb,
  challenge_done jsonb not null default '{}'::jsonb,
  profile_seal text not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.atlas_evidence (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  challenge_id text not null,
  challenge_title text not null,
  object_path text not null unique,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id),
  review_note text
);

create index if not exists atlas_evidence_user_idx on public.atlas_evidence(user_id);
create index if not exists atlas_evidence_status_idx on public.atlas_evidence(status);

-- El nombre de usuario se copia desde user_metadata al crear la cuenta.
create or replace function public.atlas_handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  requested_username text;
begin
  requested_username := lower(coalesce(new.raw_user_meta_data ->> 'username', split_part(new.email, '@', 1)));
  insert into public.atlas_profiles (user_id, username)
  values (new.id, requested_username);
  return new;
end;
$$;

drop trigger if exists atlas_on_auth_user_created on auth.users;
create trigger atlas_on_auth_user_created
after insert on auth.users
for each row execute procedure public.atlas_handle_new_user();

alter table public.atlas_profiles enable row level security;
alter table public.atlas_progress enable row level security;
alter table public.atlas_evidence enable row level security;

revoke all on public.atlas_profiles from anon, authenticated;
revoke all on public.atlas_progress from anon, authenticated;
revoke all on public.atlas_evidence from anon, authenticated;
grant select on public.atlas_profiles to authenticated;
grant select, insert, update on public.atlas_progress to authenticated;
grant select, insert on public.atlas_evidence to authenticated;

-- Los usuarios solo pueden consultar su propio perfil y progreso.
-- Un administrador se identifica mediante app_metadata.role, que el usuario no puede editar.
drop policy if exists "atlas_profiles_read_self_or_admin" on public.atlas_profiles;
create policy "atlas_profiles_read_self_or_admin"
on public.atlas_profiles for select to authenticated
using (
  user_id = (select auth.uid())
  or (select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
);

drop policy if exists "atlas_progress_read_self_or_admin" on public.atlas_progress;
create policy "atlas_progress_read_self_or_admin"
on public.atlas_progress for select to authenticated
using (
  user_id = (select auth.uid())
  or (select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
);

drop policy if exists "atlas_progress_insert_self" on public.atlas_progress;
create policy "atlas_progress_insert_self"
on public.atlas_progress for insert to authenticated
with check (user_id = (select auth.uid()));

drop policy if exists "atlas_progress_update_self" on public.atlas_progress;
create policy "atlas_progress_update_self"
on public.atlas_progress for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

drop policy if exists "atlas_evidence_read_self_or_admin" on public.atlas_evidence;
create policy "atlas_evidence_read_self_or_admin"
on public.atlas_evidence for select to authenticated
using (
  user_id = (select auth.uid())
  or (select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
);

drop policy if exists "atlas_evidence_insert_self_pending" on public.atlas_evidence;
create policy "atlas_evidence_insert_self_pending"
on public.atlas_evidence for insert to authenticated
with check (
  user_id = (select auth.uid())
  and status = 'pending'
  and reviewed_at is null
  and reviewed_by is null
);

-- Bucket privado: las capturas no tienen URL pública.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('atlas-evidence', 'atlas-evidence', false, 8388608, array['image/png','image/jpeg','image/webp'])
on conflict (id) do update set public = false, file_size_limit = 8388608, allowed_mime_types = array['image/png','image/jpeg','image/webp'];

-- Cada jugador solo puede subir a una carpeta cuyo primer segmento sea su propio UUID.
drop policy if exists "atlas_evidence_upload_own_folder" on storage.objects;
create policy "atlas_evidence_upload_own_folder"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'atlas-evidence'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists "atlas_evidence_read_own_or_admin" on storage.objects;
create policy "atlas_evidence_read_own_or_admin"
on storage.objects for select to authenticated
using (
  bucket_id = 'atlas-evidence'
  and (
    (storage.foldername(name))[1] = (select auth.uid())::text
    or (select auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
  )
);

-- Tras crear el usuario 'admin' desde la pantalla de registro, ejecuta esta consulta
-- (cambia el username si usaste otro). Después cierra sesión e inicia sesión otra vez.
-- UPDATE auth.users
-- SET raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role":"admin"}'::jsonb
-- WHERE email = 'admin@atlas.invalid';
