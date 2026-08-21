alter table file_firms
  add column if not exists contact_no text;

alter table master_firms
  add column if not exists contact_no text;

create index if not exists file_firms_contact_no_trgm_idx on file_firms using gin (contact_no gin_trgm_ops);
create index if not exists master_firms_contact_no_trgm_idx on master_firms using gin (contact_no gin_trgm_ops);
