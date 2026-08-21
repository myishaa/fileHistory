alter table files
  add column if not exists pre_bid_meeting text default 'No',
  add column if not exists pre_bid_meeting_date date,
  add column if not exists refloat_pre_bid_meeting text default 'No',
  add column if not exists refloat_pre_bid_meeting_date date;
