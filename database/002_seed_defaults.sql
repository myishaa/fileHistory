insert into divisions (name, code, allocated_capital, allocated_revenue, ad)
values
  ('Mechanical', 'MECH', null, null, 'No'),
  ('Electrical', 'ELEC', null, null, 'No'),
  ('Electronics', 'ELX', null, null, 'No'),
  ('Administration', 'ADMIN', null, null, 'No'),
  ('Procurement', 'PROC', null, null, 'No')
on conflict (name) do nothing;

insert into app_settings (
  financial_year,
  selected_year,
  theme,
  theme_tint,
  deletion_password,
  tcec_committees,
  firm_types,
  file_types,
  modes,
  milestones,
  table_field_presets
)
values (
  extract(year from current_date)::text,
  extract(year from current_date)::text,
  'light',
  'plain',
  '',
  '[]'::jsonb,
  '["MSE", "MSE (Women)", "Non-MSE"]'::jsonb,
  '["Goods & Services", "AMC", "MPC", "CARS", "O&M"]'::jsonb,
  '["OBM", "PBM", "SBM", "LBM", "LPC"]'::jsonb,
  '[]'::jsonb,
  '[]'::jsonb
)
on conflict (id) do nothing;
