create extension if not exists pg_trgm;

create index if not exists files_year_created_active_idx
on files(year, created_at desc)
where archived_at is null;

create index if not exists files_division_created_active_idx
on files(division_id, created_at desc)
where archived_at is null;

create index if not exists files_mode_upper_idx
on files(upper(trim(coalesce(mode, ''))));

create index if not exists files_file_type_trim_idx
on files(trim(coalesce(file_type, '')));

create index if not exists files_indentor_lower_trgm_idx
on files using gin (lower(coalesce(indentor, '')) gin_trgm_ops);

create index if not exists files_bid_opening_date_idx
on files(bid_opening_date)
where bid_opening_date is not null;

create index if not exists files_refloat_bid_opening_date_idx
on files(refloat_bid_opening_date)
where refloat_bid_opening_date is not null;

create index if not exists files_cfa_date_idx
on files(cfa_date)
where cfa_date is not null;

create index if not exists divisions_name_lower_trgm_idx
on divisions using gin (lower(coalesce(name, '')) gin_trgm_ops);

create index if not exists file_year_activity_year_status_file_idx
on file_year_activity(financial_year, status, file_id);

create index if not exists file_completed_milestones_milestone_file_idx
on file_completed_milestones(lower(milestone), file_id);

create index if not exists supply_orders_file_dp_date_idx
on supply_orders(file_id, dp_date)
where dp_date is not null;

create index if not exists supply_orders_dp_date_idx
on supply_orders(dp_date)
where dp_date is not null;

create index if not exists supply_orders_file_so_date_idx
on supply_orders(file_id, so_date)
where so_date is not null;

create index if not exists files_so_value_idx
on files(so_value_capital, so_value_revenue)
where so_value_capital is not null or so_value_revenue is not null;

create index if not exists supply_orders_file_value_idx
on supply_orders(file_id, so_value_capital, so_value_revenue)
where so_value_capital is not null or so_value_revenue is not null;

create index if not exists supply_orders_delivery_due_idx
on supply_orders(file_id, so_date, revised_dp, dp_date)
where so_date is not null and material_receipt_date is null;

create index if not exists supply_orders_payment_due_idx
on supply_orders(file_id, material_receipt_date, payment_date)
where material_receipt_date is not null and payment_date is null;

create index if not exists supply_orders_bg_return_due_idx
on supply_orders(file_id, bg_validity_date, bg_return_date)
where bg_validity_date is not null and bg_return_date is null;

create index if not exists supply_orders_firm_lower_trgm_idx
on supply_orders using gin (lower(coalesce(firm, '')) gin_trgm_ops);

create index if not exists file_remarks_text_lower_trgm_idx
on file_remarks using gin (lower(coalesce(text, '')) gin_trgm_ops);

create index if not exists indentors_division_name_idx
on indentors(division_id, lower(name), id);

create index if not exists indentors_name_lower_trgm_idx
on indentors using gin (lower(coalesce(name, '')) gin_trgm_ops);

create index if not exists indentors_sf_id_lower_trgm_idx
on indentors using gin (lower(coalesce(sf_id, '')) gin_trgm_ops);

create index if not exists indentors_designation_lower_trgm_idx
on indentors using gin (lower(coalesce(designation, '')) gin_trgm_ops);

create index if not exists indentors_email_lower_trgm_idx
on indentors using gin (lower(coalesce(email, '')) gin_trgm_ops);
