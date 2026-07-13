alter table app_users
  add column if not exists allowed_file_categories jsonb;
