# File History Codebase Analysis

## Frontend Folder Structure

```
src/
  components/
    app-sidebar.tsx
    top-bar.tsx
    ui/                    reusable Radix/shadcn-style UI primitives
  hooks/
    use-mobile.tsx
  lib/
    delete-password.ts
    error-capture.ts
    error-page.ts
    export-download.ts
    files-store.ts         API-backed client store and typed domain models
    milestone-validation.ts
    mmg-summary.ts
    money.ts
    table-field-presets.ts
    utils.ts
    year-filter.ts
  routes/
    __root.tsx             shell, login screen, auth gate
    add.tsx                add/edit file workflow
    dashboard.tsx          wrapper route for dashboard
    divisions.tsx          division management view
    index.tsx              dashboard implementation
    messages.tsx           message/query workflow
    mmg-live.tsx           public live status display
    quick-entry.tsx        barcode/unique-code assisted entry
    reports.tsx            reporting module
    search.tsx             advanced search and inline edit
    settings.tsx           admin/settings/archive/user management
    year-setup.tsx         financial-year/division setup
  router.tsx
  routeTree.gen.ts
  server.ts
  start.ts
  styles.css
```

## Backend Folder Structure

```
backend/src/
  db/
    pool.ts                PostgreSQL pool, max 30 connections
  routes/
    auth.ts                staff and viewer login, logout, current user
    dashboard.ts           dashboard summary API
    divisions.ts           divisions, archive, merge, split-transfer
    exports.ts             generic PDF/XLS export endpoint
    files.ts               files CRUD, search, export, archive, restore
    health.ts              health and IP endpoints
    indentors.ts           indentor CRUD and paginated search
    live.ts                public MMG live summary endpoint
    messages.ts            viewer/editor message workflow
    reports.ts             report summary API
    settings.ts            app settings, years, thresholds, presets
    users.ts               admin user management
  utils/
    auth.ts                cookie sessions and RBAC helpers
    cache.ts               in-memory TTL cache
    dashboard-summary.ts
    db-values.ts
    export-files.ts
    file-search.ts
    http.ts
    report-summary.ts
  server.ts
  types.ts
```

## Database Tables and Relationships

- **divisions**: primary key id; name, code, allocations, AD flag, viewer password hash, archive metadata; Referenced by files, users, indentors, sessions, messages.
- **app_users**: primary key id; name, username, role, password_hash, is_active; Linked to sessions and user_divisions.
- **user_divisions**: primary key user_id + division_id; User-to-division access map; Many-to-many RBAC scope.
- **auth_sessions**: primary key id; token_hash, user_id or viewer_division_id, expires_at; Cookie session backing store.
- **app_settings**: primary key id=true; financial years, theme, deletion password, milestones, presets, MMG settings; Singleton configuration.
- **files**: primary key id; Core file/procurement metadata, lifecycle dates, values, current milestone, archive fields; Central domain entity.
- **file_firms**: primary key id; Invited/bidder firm rows; Many child rows per file.
- **supply_orders**: primary key id; Supply order, delivery, BG, IR, bill and payment fields; Many child rows per file.
- **file_remarks**: primary key id; Section remarks with creation timestamp; Many child rows per file.
- **file_completed_milestones**: primary key file_id + milestone; Completed milestone names; Many-to-one file lifecycle state.
- **file_year_activity**: primary key file_id + financial_year; Active/closed status by financial year; Multi-year retention.
- **financial_years**: primary key label; Known financial year labels; Settings and reports.
- **division_year_allocations**: primary key id; Per-year capital/revenue allocation and active flag; Division planning.
- **tcec_committees**: primary key id; Financial-year TCEC committee names; Add-file options.
- **value_threshold_levels**: primary key id; Yearly value threshold levels; Analytics.
- **indentors**: primary key id; Division indentor master data; File and split-transfer workflows.
- **division_merges**: primary key id; Merge metadata; Division restructuring history.
- **division_merge_sources**: primary key merge_id + source_division_id; Merge source divisions; Merge details.
- **file_division_history**: primary key id; From/to division movements; Audit-like movement history.
- **file_messages**: primary key id; Viewer queries, status, viewed/deleted/resolved data; Message workflow.
- **file_message_replies**: primary key id; Editor/admin replies; Message workflow.
- **user_table_field_presets**: primary key owner_key; Personal table presets; Search/table customization.
- **user_live_status_preferences**: primary key owner_key; Live status field preferences; Dashboard preferences.

## Database Indexes

- Primary keys use UUIDs generated by pgcrypto.
- files.unique_code has a partial unique index where code is non-empty.
- files(year, created_at desc) and files(division_id, created_at desc) partial indexes support active file listing.
- GIN trigram indexes exist for file title, file number, IMMS, demand description, indentor, division name, firm names, supply-order firm, remarks, and indentor text fields.
- Lifecycle and report indexes include bid opening dates, CFA date, delivery due, payment due, BG return due, supply-order dates, and value fields.
- auth_sessions is indexed by user, viewer division, token hash uniqueness, and expiry time.
- file_year_activity(financial_year, status, file_id) supports multi-year filtering.
- file_completed_milestones(lower(milestone), file_id) supports milestone filters.

## API Routes

- GET / - Service identity JSON
- GET /api/health - Database health check
- GET /api/health/ip - Client IP display for login screen
- POST /api/auth/login - Staff login using username/password and cookie session
- POST /api/auth/viewer-login - Division viewer login using division password
- GET /api/auth/me - Return current authenticated user or null
- POST /api/auth/logout - Delete session and clear cookie
- GET /api/files - List accessible files by year/division
- GET /api/files/search - Paginated advanced search
- POST /api/files/export/search - Export searched file list as XLS/PDF
- GET /api/files/next-unique-code - Generate next unique code for year/division
- GET /api/files/by-unique-code/:code - Lookup file by unique code for barcode workflow
- GET /api/files/:id - Load one file
- POST /api/files - Create file with nested firms/orders/remarks/milestones
- PATCH /api/files/:id - Patch file and optionally nested child data
- DELETE /api/files/:id - Archive for non-admins, hard delete for admins
- GET /api/files/archive/list - Admin archived file list
- DELETE /api/files/archive/:id - Admin permanent delete of archived file
- POST /api/files/:id/restore - Admin restore archived file
- GET /api/dashboard/summary - Permission-scoped dashboard summary
- GET /api/reports/summary - Permission-scoped report summary
- POST /api/exports/table - Generic table export
- GET /api/divisions - List divisions for financial year
- POST /api/divisions - Admin create division/year allocation
- PATCH /api/divisions/:id - Admin update division/allocation/viewer password
- DELETE /api/divisions/:id - Admin archive division
- GET /api/divisions/archive/list - Admin archived divisions
- POST /api/divisions/:id/restore - Admin restore division
- DELETE /api/divisions/archive/:id - Admin permanent delete division
- POST /api/divisions/merge - Admin merge divisions and move active files
- POST /api/divisions/split-transfer - Admin transfer indentors/files/allocations
- GET /api/indentors - Paginated indentor search
- POST /api/indentors - Create indentor
- PATCH /api/indentors/:id - Admin/sub-admin update indentor
- DELETE /api/indentors/:id - Admin/sub-admin delete indentor
- GET /api/messages - List scoped messages
- POST /api/messages - Viewer/division user creates query
- POST /api/messages/:id/replies - Editor/admin replies
- POST /api/messages/:id/resolve - Editor/admin resolves
- POST /api/messages/:id/view - Mark message viewed
- DELETE /api/messages/:id - Soft-delete message
- GET /api/settings - Load settings and user preferences
- PATCH /api/settings - Update settings/preferences
- POST /api/settings/financial-years - Admin add year
- DELETE /api/settings/financial-years/:label - Admin delete unused year
- GET /api/users - Admin list users
- POST /api/users - Admin create user
- PATCH /api/users/:id - Admin update user
- DELETE /api/users/:id - Admin delete user
- GET /api/live/mmg - Public live MMG summary

## Implemented Features

- Staff login, viewer login, logout, and current-user detection
- HTTP-only cookie sessions backed by hashed tokens in PostgreSQL
- Roles: admin, sub_admin, editor, division_user, viewer
- Division-scoped access control for files, messages, indentors, dashboard, reports, and search
- File create, edit, soft archive, restore, and admin permanent delete
- Nested file data for invited firms, bidder firms, supply orders, remarks, active years, and completed milestones
- Advanced search with text, date, value, mode, milestone, dashboard, analytics, and cancellation filters
- Pagination for file search and indentor search
- Search and table export to Excel-compatible HTML and generated PDF
- Dashboard summary, status flow, live status rows, analytics, and finance totals
- Reports summary including status tables, cash outgo reports, delay rows, and historical ranges
- In-memory TTL caching for auth, settings, divisions, lookups, dashboard summaries, and report summaries
- Unique-code generation and unique-code lookup used by Quick Entry barcode-assisted retrieval
- Quick Entry workflow that scans/types a unique code and opens the current milestone section
- Division management, yearly allocations, division archive/restore, merge, and split-transfer
- Indentor master data management and search
- Viewer/editor message workflow with replies, resolve, viewed timestamp, and soft delete
- Settings for financial years, theme, milestones, TCEC committees, value thresholds, table presets, MMG live, and MMG summary fields
- Public MMG live page with periodic refresh
- Health and client IP endpoints

## Missing or Planned Features

- Dedicated audit logging table for every create/update/delete action
- Notification delivery through email, SMS, or in-app unread counters beyond the current message workflow
- Mobile application or camera-native scanning experience
- Cloud deployment automation with managed PostgreSQL
- Document attachment storage and OCR indexing
- Redis or distributed cache for multi-application-server deployment
- Read replicas for heavy analytical reporting
- Formal automated test suite and load-test reports

## System Design Decisions Visible in Code

- React, TypeScript, TanStack Router, React Query, Tailwind CSS, and reusable UI primitives compose the frontend.
- Express with TypeScript exposes REST APIs under /api.
- PostgreSQL is used with pg Pool max 30, connection timeout 5000 ms, idle timeout 30000 ms.
- Authentication uses random session tokens in an HTTP-only cookie named recordkeeper_session; only SHA-256 hashes are stored in auth_sessions.
- Password verification and password creation use PostgreSQL pgcrypto crypt and gen_salt('bf').
- Authorization is centralized in backend/src/utils/auth.ts through requireAuth, requireAdmin, canMutateFiles, canUseAllDivisions, canAccessDivision, and getDivisionScopeCondition.
- Search is primarily SQL-backed and parameterized. A legacy in-memory comparator exists only behind FILES_SQL_COMPARE_LEGACY for selected dashboard filters.
- Dashboard summaries are cached for 30 seconds; report summaries for 60 seconds; keys include permission scope and query options.
- Mutation endpoints clear dashboard/report or lookup cache prefixes.
- File and division destructive actions require a configured deletion password for permanent deletion; non-admin file delete archives instead of deleting.
- Single-server in-memory caching is visible; Redis is not implemented.
