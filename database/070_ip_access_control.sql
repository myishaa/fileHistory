alter table app_users
  add column if not exists emergency_ip_bypass boolean not null default false;

create table if not exists ip_access_settings (
  id boolean primary key default true,
  mode text not null default 'off' check (mode in ('off', 'notify', 'restrict')),
  updated_by_user_id uuid references app_users(id) on delete set null,
  updated_by_name text,
  updated_at timestamptz not null default now()
);

insert into ip_access_settings (id, mode)
values (true, 'off')
on conflict (id) do nothing;

create table if not exists trusted_ip_addresses (
  id uuid primary key default gen_random_uuid(),
  ip_address text not null unique,
  remarks text not null default '',
  active boolean not null default true,
  created_by_user_id uuid references app_users(id) on delete set null,
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists ip_login_attempts (
  id uuid primary key default gen_random_uuid(),
  ip_address text not null,
  username text not null,
  user_id uuid references app_users(id) on delete set null,
  user_name text,
  user_role text,
  mode text not null check (mode in ('off', 'notify', 'restrict')),
  result text not null check (result in ('allowed', 'blocked', 'bypassed')),
  reason text not null,
  attempted_at timestamptz not null default now(),
  archived_at timestamptz,
  archived_by_user_id uuid references app_users(id) on delete set null,
  archived_by_name text
);

create index if not exists ip_login_attempts_active_idx
  on ip_login_attempts(archived_at, attempted_at desc);

create index if not exists trusted_ip_addresses_ip_idx
  on trusted_ip_addresses(ip_address);
