alter table files
add column if not exists refloat_post_tcec_date date,
add column if not exists refloat_post_tcec_minutes_date date,
add column if not exists refloat_post_tcec_committee_no text;
