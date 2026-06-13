create extension if not exists pgcrypto;

alter table app_users
  add column if not exists password_hash text,
  add column if not exists is_active boolean not null default true;

alter table app_users
  drop constraint if exists app_users_role_check;

alter table app_users
  add constraint app_users_role_check
  check (role in ('admin', 'sub_admin', 'editor', 'viewer', 'division_user'));

alter table divisions
  add column if not exists viewer_password_hash text;

alter table files
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references app_users(id) on delete set null,
  add column if not exists archive_reason text;

create table if not exists auth_sessions (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  user_id uuid references app_users(id) on delete cascade,
  viewer_division_id uuid references divisions(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  check (user_id is not null or viewer_division_id is not null)
);

create index if not exists auth_sessions_user_id_idx on auth_sessions(user_id);
create index if not exists auth_sessions_viewer_division_id_idx on auth_sessions(viewer_division_id);
create index if not exists auth_sessions_expires_at_idx on auth_sessions(expires_at);
create index if not exists files_archived_at_idx on files(archived_at);

insert into app_users (name, username, role, password_hash, is_active)
values ('Ovais', 'ovais', 'admin', crypt('ovais123', gen_salt('bf')), true)
on conflict (username) do nothing;
