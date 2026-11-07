alter table files
  add column if not exists refloat_gem_bidding_mode text,
  add column if not exists refloat_rfp_vetting text not null default 'No',
  add column if not exists refloat_rfp_vetting_initiation_date date,
  add column if not exists refloat_rfp_vetting_approval_date date,
  add column if not exists refloat_bid_number text,
  add column if not exists refloat_tender_live text not null default 'No',
  add column if not exists refloat_bid_opened text not null default 'NO';
