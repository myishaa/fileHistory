update app_settings
set file_types = coalesce(file_types, '[]'::jsonb) || '["O&M"]'::jsonb
where not exists (
  select 1
  from jsonb_array_elements_text(coalesce(file_types, '[]'::jsonb)) as value
  where upper(trim(value)) = 'O&M'
);

alter table app_settings
alter column file_types set default '["Goods & Services", "AMC", "MPC", "CARS", "O&M"]'::jsonb;

update app_users
set allowed_file_categories = allowed_file_categories || '["om"]'::jsonb
where allowed_file_categories is not null
  and allowed_file_categories @> '["goodsServices", "amc", "mpc", "cars"]'::jsonb
  and not allowed_file_categories @> '["om"]'::jsonb;
