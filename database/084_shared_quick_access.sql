alter table app_settings
  add column if not exists shared_quick_access jsonb not null
  default '{"initialized": false, "favorites": [], "noticeBoardItems": [], "noticeBoardIntervalSeconds": 15}'::jsonb;
