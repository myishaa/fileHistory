update app_settings
set firm_types = '["MSE", "MSE (Women)", "Non-MSE"]'::jsonb
where firm_types = '["MSE", "DPSU", "Startup", "Local Vendor", "OEM"]'::jsonb;
