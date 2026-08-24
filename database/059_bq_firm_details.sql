alter table files
add column if not exists bq_basis text;

alter table file_firms
drop constraint if exists file_firms_firm_type_check;

alter table file_firms
add constraint file_firms_firm_type_check check (firm_type in ('bq', 'invited', 'bidder'));
