alter table app_settings
  add column if not exists firm_unique_no_label text not null default 'Firm Unique No.';

alter table file_firms
  add column if not exists address text,
  add column if not exists firm_unique_no text;

create table if not exists master_firms (
  id uuid primary key default gen_random_uuid(),
  firm_name text,
  email_id text,
  city text,
  address text,
  firm_unique_no text,
  created_by uuid references app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    nullif(btrim(coalesce(firm_name, '')), '') is not null or
    nullif(btrim(coalesce(email_id, '')), '') is not null or
    nullif(btrim(coalesce(firm_unique_no, '')), '') is not null
  )
);

drop trigger if exists master_firms_set_updated_at on master_firms;
create trigger master_firms_set_updated_at
before update on master_firms
for each row execute function set_updated_at();

create index if not exists file_firms_email_trgm_idx on file_firms using gin (email_id gin_trgm_ops);
create index if not exists file_firms_unique_no_trgm_idx on file_firms using gin (firm_unique_no gin_trgm_ops);
create unique index if not exists master_firms_unique_no_idx
on master_firms (lower(btrim(firm_unique_no)))
where nullif(btrim(firm_unique_no), '') is not null;
create index if not exists master_firms_name_trgm_idx on master_firms using gin (firm_name gin_trgm_ops);
create index if not exists master_firms_email_trgm_idx on master_firms using gin (email_id gin_trgm_ops);
create index if not exists master_firms_unique_no_trgm_idx on master_firms using gin (firm_unique_no gin_trgm_ops);
