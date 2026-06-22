drop index if exists files_file_type_trim_idx;
drop index if exists files_file_type_idx;

alter table files
drop column if exists file_type;
