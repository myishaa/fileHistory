# Recordkeeper PostgreSQL Database

This folder contains the PostgreSQL schema for the Recordkeeper app.

Run these files against a new PostgreSQL database:

```sh
psql "$DATABASE_URL" -f database/001_initial_schema.sql
psql "$DATABASE_URL" -f database/002_seed_defaults.sql
psql "$DATABASE_URL" -f database/003_auth_and_archive.sql
psql "$DATABASE_URL" -f database/004_yearly_division_allocations.sql
psql "$DATABASE_URL" -f database/005_financial_years.sql
psql "$DATABASE_URL" -f database/006_year_context.sql
psql "$DATABASE_URL" -f database/007_division_archive.sql
psql "$DATABASE_URL" -f database/008_division_merges.sql
psql "$DATABASE_URL" -f database/009_user_table_field_presets.sql
psql "$DATABASE_URL" -f database/010_table_field_preset_owner_keys.sql
psql "$DATABASE_URL" -f database/011_value_threshold_levels.sql
psql "$DATABASE_URL" -f database/012_year_selection_lock.sql
psql "$DATABASE_URL" -f database/013_indentors.sql
psql "$DATABASE_URL" -f database/014_bid_number.sql
psql "$DATABASE_URL" -f database/015_search_indexes.sql
psql "$DATABASE_URL" -f database/016_user_live_status_preferences.sql
psql "$DATABASE_URL" -f database/017_file_messages.sql
psql "$DATABASE_URL" -f database/018_message_workflow_controls.sql
psql "$DATABASE_URL" -f database/019_mmg_live_settings.sql
psql "$DATABASE_URL" -f database/020_drop_file_type.sql
psql "$DATABASE_URL" -f database/021_ir_milestone_dates.sql
psql "$DATABASE_URL" -f database/022_bill_preparation_date.sql
psql "$DATABASE_URL" -f database/023_drop_refloat_post_tcec_fields.sql
psql "$DATABASE_URL" -f database/024_mmg_summary_settings.sql
psql "$DATABASE_URL" -f database/025_file_ir_flag.sql
```

The backend will read the same `DATABASE_URL` from `backend/.env`.

The auth migration creates the initial admin login:

- Username: `ovais`
- Password: `ovais123`

```sh
cd backend
cp .env.example .env
npm install
npm run dev
```

Once the server is running, the database connection health check is:

```sh
curl http://localhost:3000/api/health
```

## Initial API Routes

- `GET /api/health`
- `POST /api/auth/login`
- `POST /api/auth/viewer-login`
- `GET /api/auth/me`
- `POST /api/auth/logout`
- `GET /api/divisions`
- `POST /api/divisions`
- `PATCH /api/divisions/:id`
- `DELETE /api/divisions/:id`
- `GET /api/users`
- `POST /api/users`
- `PATCH /api/users/:id`
- `DELETE /api/users/:id`
- `GET /api/settings`
- `PATCH /api/settings`
- `GET /api/files`
- `GET /api/files/:id`
- `POST /api/files`
- `PATCH /api/files/:id`
- `DELETE /api/files/:id`
- `GET /api/messages`
- `POST /api/messages`
- `POST /api/messages/:id/replies`
- `POST /api/messages/:id/resolve`

The file endpoints accept and return the current frontend-style camelCase shape. Empty strings are stored as `null` for dates, numbers, and optional text fields. Nested file data is stored in child tables:

- `invitedFirms` and `bidderFirms` -> `file_firms`
- `supplyOrders` -> `supply_orders`
- `remarks` -> `file_remarks`
- `messages` -> `file_messages` and `file_message_replies`
- `completedMilestones` -> `file_completed_milestones`

## Main Tables

- `files`: core file/procurement records.
- `divisions`: office divisions such as Mechanical, Electrical, Electronics.
- `division_year_allocations`: year-wise active flag and capital/revenue allocation per division.
- `division_merges`: year-wise division merge decisions.
- `division_merge_sources`: source divisions included in each merge.
- `file_division_history`: audit trail when files move between divisions.
- `indentors`: division-wise indentor master list used when adding or editing files.
- `tcec_committees`: year-wise TCEC committee names.
- `file_year_activity`: financial years where a file is active or continued.
- `user_table_field_presets`: private table field presets for each editor, sub-admin, or viewer.
- `value_threshold_levels`: year-wise admin-defined file value thresholds.
- `app_users`: temporary app users and future login users.
- `user_divisions`: division access for non-admin users.
- `app_settings`: workspace settings used by the frontend and backend.
- `financial_years`: saved financial years shown in year dropdowns.
- `file_firms`: invited and bidder firm rows.
- `supply_orders`: multiple supply order rows for a file.
- `file_remarks`: remarks grouped by section.
- `file_messages`: division viewer queries grouped by file and section.
- `file_message_replies`: editor/admin replies to file messages.
- `divisions.messages_enabled`: admin-controlled switch for enabling viewer messages per division.
- `app_settings.mmg_live_enabled` / `mmg_live_options`: admin-selected trial MMG Live public dashboard blocks.
- `file_completed_milestones`: completed milestone names per file.

The schema is designed so the current frontend can later receive data in the same shape as `FileRecord`, while the backend stores repeated data like firms, remarks, and supply orders in proper child tables.
