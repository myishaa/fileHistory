create table if not exists protected_backup_settings (
  id boolean primary key default true check (id),
  restore_authorization_password_hash text not null default '',
  updated_at timestamptz not null default now()
);

insert into protected_backup_settings (id)
values (true)
on conflict (id) do nothing;
