alter table if exists protected_backup_settings
  add column if not exists restore_authorization_recovery_pin_hash text not null default '';
