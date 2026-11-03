alter table if exists file_messages
  add column if not exists recipient_user_id uuid references app_users(id) on delete set null;

create index if not exists file_messages_recipient_user_idx
  on file_messages(recipient_user_id)
  where recipient_user_id is not null;
