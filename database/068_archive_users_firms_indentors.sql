alter table app_users
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references app_users(id) on delete set null,
  add column if not exists archive_reason text;

create index if not exists app_users_archived_at_idx on app_users(archived_at);

alter table master_firms
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references app_users(id) on delete set null,
  add column if not exists archive_reason text;

drop index if exists master_firms_unique_no_idx;
create unique index if not exists master_firms_unique_no_idx
on master_firms (lower(btrim(firm_unique_no)))
where nullif(btrim(firm_unique_no), '') is not null and archived_at is null;
create index if not exists master_firms_archived_at_idx on master_firms(archived_at);

alter table indentors
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references app_users(id) on delete set null,
  add column if not exists archive_reason text;

alter table indentors
  drop constraint if exists indentors_division_id_sf_id_key;
drop index if exists indentors_division_sf_id_active_key;
create unique index if not exists indentors_division_sf_id_active_key
on indentors (division_id, sf_id)
where archived_at is null;
create index if not exists indentors_archived_at_idx on indentors(archived_at);
