create table if not exists indentors (
  id uuid primary key default gen_random_uuid(),
  division_id uuid not null references divisions(id) on delete cascade,
  name text not null,
  sf_id text not null,
  designation text not null,
  mobile_no text not null,
  landline_no text not null,
  email text not null,
  created_by uuid references app_users(id) on delete set null,
  archived_at timestamptz,
  archived_by uuid references app_users(id) on delete set null,
  archive_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists indentors_set_updated_at on indentors;
create trigger indentors_set_updated_at
before update on indentors
for each row execute function set_updated_at();

create index if not exists indentors_division_id_idx on indentors(division_id);
create index if not exists indentors_name_idx on indentors(lower(name));
create unique index if not exists indentors_division_sf_id_active_key
on indentors (division_id, sf_id)
where archived_at is null;
create index if not exists indentors_archived_at_idx on indentors(archived_at);
