update app_settings
set modes = coalesce(
  (
    select jsonb_agg(value)
    from jsonb_array_elements_text(coalesce(app_settings.modes, '[]'::jsonb)) as item(value)
    where upper(trim(value)) <> 'CARS'
  ),
  '[]'::jsonb
);
