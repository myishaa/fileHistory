create table if not exists file_indentor_history (
  id uuid primary key default gen_random_uuid(),
  file_id uuid not null references files(id) on delete cascade,
  from_indentor_id uuid references indentors(id) on delete set null,
  to_indentor_id uuid references indentors(id) on delete set null,
  from_indentor_name text not null,
  to_indentor_name text not null,
  from_division_id uuid references divisions(id) on delete set null,
  to_division_id uuid references divisions(id) on delete set null,
  transfer_scope text not null,
  financial_year text,
  reason text,
  transferred_by_user_id uuid references app_users(id) on delete set null,
  transferred_by_name text,
  transferred_at timestamptz not null default now()
);

create index if not exists file_indentor_history_file_idx
on file_indentor_history(file_id);

create index if not exists file_indentor_history_indentor_idx
on file_indentor_history(from_indentor_id, to_indentor_id);

create index if not exists file_indentor_history_transferred_at_idx
on file_indentor_history(transferred_at desc);
