alter table app_settings
  add column if not exists global_chart_color_order jsonb not null default '["#0f766e", "#2563eb", "#d97706", "#be123c", "#7c3aed", "#65a30d", "#0891b2", "#475569", "#e11d48", "#ea580c", "#4f46e5", "#16a34a", "#9333ea", "#0284c7", "#a16207", "#0d9488", "#c026d3", "#dc2626", "#84cc16", "#0369a1", "#b45309", "#7e22ce", "#15803d", "#be185d", "#64748b"]'::jsonb;

alter table app_settings
  add column if not exists global_chart_colors_enforced boolean not null default false;
