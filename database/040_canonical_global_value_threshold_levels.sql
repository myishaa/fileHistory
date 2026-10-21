do $$
declare
  canonical_year text;
  seeded_year text;
begin
  with settings_year as (
    select setup_year, financial_year
    from app_settings
    where id = true
  ),
  year_configs as (
    select
      financial_year,
      jsonb_agg(
        jsonb_build_array(level_number, label, min_value, max_value, applies_to)
        order by level_number
      ) as config
    from value_threshold_levels
    where financial_year <> '__global__'
    group by financial_year
  ),
  config_frequency as (
    select config, count(*) as year_count
    from year_configs
    group by config
  )
  select year_configs.financial_year
  into canonical_year
  from year_configs
  join config_frequency using (config)
  cross join settings_year
  order by
    config_frequency.year_count desc,
    case
      when year_configs.financial_year = settings_year.setup_year then 0
      when year_configs.financial_year = settings_year.financial_year then 1
      else 2
    end,
    year_configs.financial_year desc
  limit 1;

  select levels.financial_year
  into seeded_year
  from value_threshold_levels levels
  cross join app_settings settings
  where settings.id = true
    and levels.financial_year <> '__global__'
  group by levels.financial_year, settings.setup_year, settings.financial_year
  order by
    case
      when levels.financial_year = settings.setup_year then 0
      when levels.financial_year = settings.financial_year then 1
      else 2
    end,
    levels.financial_year desc
  limit 1;

  if canonical_year is not null and (
    not exists (
      select 1 from value_threshold_levels where financial_year = '__global__'
    )
    or (
      select jsonb_agg(
        jsonb_build_array(level_number, label, min_value, max_value, applies_to)
        order by level_number
      )
      from value_threshold_levels
      where financial_year = '__global__'
    ) is not distinct from (
      select jsonb_agg(
        jsonb_build_array(level_number, label, min_value, max_value, applies_to)
        order by level_number
      )
      from value_threshold_levels
      where financial_year = seeded_year
    )
  ) then
    delete from value_threshold_levels where financial_year = '__global__';

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
      level_number,
      label,
      min_value,
      max_value,
      applies_to
    from value_threshold_levels
    where financial_year = canonical_year
    order by level_number;
  end if;
end $$;
