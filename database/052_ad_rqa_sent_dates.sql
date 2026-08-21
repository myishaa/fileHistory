alter table files
  add column if not exists ad_sent_date date,
  add column if not exists rqa_sent_date date;
