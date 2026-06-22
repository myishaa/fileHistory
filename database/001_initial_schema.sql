create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

create table divisions (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  code text unique,
  allocated_capital numeric(14, 2),
  allocated_revenue numeric(14, 2),
  ad text default 'No',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table app_users (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  username text not null unique,
  role text not null check (role in ('admin', 'division_user', 'editor', 'viewer')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table user_divisions (
  user_id uuid not null references app_users(id) on delete cascade,
  division_id uuid not null references divisions(id) on delete cascade,
  primary key (user_id, division_id)
);

create table app_settings (
  id boolean primary key default true check (id),
  financial_year text not null,
  selected_year text not null,
  theme text not null default 'light' check (theme in ('light', 'dark')),
  theme_tint text not null default 'plain' check (
    theme_tint in ('plain', 'yellow', 'green', 'blue', 'pink', 'lavender')
  ),
  deletion_password text not null default '',
  tcec_committees jsonb not null default '[]'::jsonb,
  milestones jsonb not null default '[]'::jsonb,
  table_field_presets jsonb not null default '[]'::jsonb,
  active_user_id uuid references app_users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table files (
  id uuid primary key default gen_random_uuid(),
  title text,
  division_id uuid references divisions(id) on delete set null,
  officer text,
  imms text,
  file_date date,
  year text,
  unique_code text,
  received_date date,
  scrutiny_date date,
  scrutiny_response_date date,
  scrutiny_completion_date date,
  imms_date date,
  file_no text,
  indentor text,
  demand_description text,
  value_capital numeric(14, 2),
  value_revenue numeric(14, 2),
  currency text default 'INR',
  exchange_rate numeric(14, 6) default 1,
  gte text,
  tcec text,
  mode text,
  gem text,
  high_value text,
  ad text,
  rqa text,
  ifa text,
  psb text,
  bg text,
  rfp_vetting text,
  high_value_meeting_date date,
  high_value_minutes_date date,
  pre_tcec_date date,
  pre_tcec_minutes_date date,
  pre_tcec_committee_no text,
  ad_vetting_date date,
  rqa_approval_date date,
  ifa_sent_date date,
  ifa_final_date date,
  cfa_sent_date date,
  cfa_date date,
  gem_undertaking_date date,
  rfp_vetting_initiation_date date,
  rfp_vetting_approval_date date,
  tender_live text,
  bid_number text,
  bid_date date,
  bid_opening_date date,
  bid_opened text,
  refloat text,
  post_tcec_date date,
  post_tcec_minutes_date date,
  post_tcec_committee_number text,
  refloat_bidding_date date,
  refloat_bid_opening_date date,
  refloat_post_tcec_date date,
  refloat_post_tcec_minutes_date date,
  refloat_post_tcec_committee_no text,
  rst text,
  bidding_stage_over text,
  cnc_date date,
  cnc_approval_date date,
  no_of_so integer,
  so_no text,
  gem_so_no text,
  so_date date,
  so_value_capital numeric(14, 2),
  so_value_revenue numeric(14, 2),
  dp_date date,
  firm text,
  bg_validity_date date,
  dp_extension text,
  dp_extension_count integer,
  ld text,
  revised_dp date,
  material_receipt_date date,
  bill_sent_for_payment_date date,
  payment_date date,
  payment_mode text,
  bg_return_date date,
  demand_cancelled text,
  so_cancelled text,
  so_cancelled_date date,
  current_milestone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table file_completed_milestones (
  file_id uuid not null references files(id) on delete cascade,
  milestone text not null,
  completed_at timestamptz,
  primary key (file_id, milestone)
);

create table file_firms (
  id uuid primary key default gen_random_uuid(),
  file_id uuid not null references files(id) on delete cascade,
  firm_type text not null check (firm_type in ('invited', 'bidder')),
  firm_name text,
  city text,
  email_id text,
  sort_order integer not null default 0
);

create table supply_orders (
  id uuid primary key default gen_random_uuid(),
  file_id uuid not null references files(id) on delete cascade,
  so_no text,
  gem_so_no text,
  so_date date,
  so_value_capital numeric(14, 2),
  so_value_revenue numeric(14, 2),
  dp_date date,
  firm text,
  bg_validity_date date,
  dp_extension text,
  dp_extension_count integer,
  ld text,
  revised_dp date,
  material_receipt_date date,
  bill_sent_for_payment_date date,
  payment_date date,
  payment_mode text,
  bg_return_date date,
  demand_cancelled text,
  so_cancelled text,
  so_cancelled_date date,
  sort_order integer not null default 0
);

create table file_remarks (
  id uuid primary key default gen_random_uuid(),
  file_id uuid not null references files(id) on delete cascade,
  section text not null,
  text text not null,
  created_at timestamptz not null default now()
);

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger divisions_set_updated_at
before update on divisions
for each row execute function set_updated_at();

create trigger app_users_set_updated_at
before update on app_users
for each row execute function set_updated_at();

create trigger files_set_updated_at
before update on files
for each row execute function set_updated_at();

create trigger app_settings_set_updated_at
before update on app_settings
for each row execute function set_updated_at();

create index files_year_idx on files(year);
create index files_division_id_idx on files(division_id);
create unique index files_unique_code_key on files(unique_code)
where unique_code is not null and unique_code <> '';
create index files_created_at_idx on files(created_at desc);
create index files_current_milestone_idx on files(current_milestone);
create index files_mode_idx on files(mode);
create index files_payment_pending_idx on files(bill_sent_for_payment_date, payment_date);
create index files_delivery_pending_idx on files(dp_date, material_receipt_date);
create index files_title_trgm_idx on files using gin (title gin_trgm_ops);
create index files_file_no_trgm_idx on files using gin (file_no gin_trgm_ops);
create index files_imms_trgm_idx on files using gin (imms gin_trgm_ops);
create index files_demand_description_trgm_idx on files using gin (demand_description gin_trgm_ops);
create index file_firms_file_id_idx on file_firms(file_id);
create index file_firms_name_trgm_idx on file_firms using gin (firm_name gin_trgm_ops);
create index supply_orders_file_id_idx on supply_orders(file_id);
create index supply_orders_firm_trgm_idx on supply_orders using gin (firm gin_trgm_ops);
create index file_remarks_file_id_idx on file_remarks(file_id);
