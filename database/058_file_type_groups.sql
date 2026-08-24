alter table app_settings
add column if not exists file_type_groups jsonb not null
default '[
  {"fileType":"Goods & Services","group":"goodsServices"},
  {"fileType":"AMC","group":"contract"},
  {"fileType":"MPC","group":"contract"},
  {"fileType":"CARS","group":"contract"},
  {"fileType":"O&M","group":"contract"}
]'::jsonb;

alter table files
add column if not exists file_type_group text not null default 'goodsServices';

update files
set file_type_group = case
  when lower(trim(coalesce(file_type, ''))) in ('amc', 'mpc', 'cars', 'o&m') then 'contract'
  else 'goodsServices'
end
where file_type_group is null
   or file_type_group not in ('goodsServices', 'contract')
   or file_type_group = 'goodsServices';
