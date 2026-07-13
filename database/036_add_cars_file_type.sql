update app_settings
set file_types = coalesce(file_types, '[]'::jsonb) || '["CARS"]'::jsonb
where not exists (
  select 1
  from jsonb_array_elements_text(coalesce(file_types, '[]'::jsonb)) as item(value)
  where upper(trim(value)) = 'CARS'
);
