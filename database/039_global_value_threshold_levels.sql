with settings_year as (
  select
    setup_year,
    financial_year
  from app_settings
  where id = true
),
source_year as (
  select levels.financial_year
  from value_threshold_levels levels
  cross join settings_year settings
  group by levels.financial_year, settings.setup_year, settings.financial_year
  order by
    case
      when levels.financial_year = settings.setup_year then 0
      when levels.financial_year = settings.financial_year then 1
      else 2
    end,
    levels.financial_year desc
  limit 1
)
insert into value_threshold_levels (
  financial_year,
  level_number,
  label,
  min_value,
  max_value,
  applies_to
)
select
  '__global__',
  levels.level_number,
  levels.label,
  levels.min_value,
  levels.max_value,
  levels.applies_to
from value_threshold_levels levels
join source_year on source_year.financial_year = levels.financial_year
where not exists (
  select 1
  from value_threshold_levels existing
  where existing.financial_year = '__global__'
)
on conflict (financial_year, level_number) do nothing;
