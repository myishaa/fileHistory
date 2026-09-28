create unique index if not exists indentors_division_sf_id_nonempty_active_key
on indentors (division_id, sf_id)
where archived_at is null and nullif(btrim(sf_id), '') is not null;

drop index if exists indentors_division_sf_id_active_key;
