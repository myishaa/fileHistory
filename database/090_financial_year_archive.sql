alter table financial_years
  add column if not exists is_archived boolean not null default false;

alter table financial_years
  add column if not exists archived_at timestamptz;

alter table financial_years
  add column if not exists archived_by uuid references app_users(id) on delete set null;

create index if not exists financial_years_archived_label_idx
  on financial_years (is_archived, label);
