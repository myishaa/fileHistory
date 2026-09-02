alter table app_users
  drop constraint if exists app_users_role_check;

alter table app_users
  add constraint app_users_role_check
  check (role in ('admin', 'sub_admin', 'editor', 'viewer', 'division_user', 'universal_viewer'));
