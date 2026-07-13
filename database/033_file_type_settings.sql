alter table app_settings
add column if not exists file_types jsonb not null
default '["Goods & Services", "AMC", "MPC", "CARS", "O&M"]'::jsonb;

update app_settings
set file_types = '["Goods & Services", "AMC", "MPC", "CARS", "O&M"]'::jsonb
where file_types is null or file_types = '[]'::jsonb;

alter table files
add column if not exists file_type text not null
default 'Goods & Services';

update files
set file_type = 'Goods & Services'
where file_type is null or trim(file_type) = '';

create index if not exists files_file_type_idx on files(file_type);
