alter table user_ui_preferences
  add column if not exists chart_color_order jsonb;
