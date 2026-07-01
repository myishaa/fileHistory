import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = process.cwd();
const outFile = path.join(root, "File_History_Project_Report.docx");
const analysisFile = path.join(root, "File_History_Codebase_Analysis.md");
const tmp = path.join(root, ".report-docx-tmp");

const frontendStructure = `src/
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
  styles.css`;

const backendStructure = `backend/src/
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
  types.ts`;

const apiRows = [
  ["GET", "/", "Service identity JSON"],
  ["GET", "/api/health", "Database health check"],
  ["GET", "/api/health/ip", "Client IP display for login screen"],
  ["POST", "/api/auth/login", "Staff login using username/password and cookie session"],
  ["POST", "/api/auth/viewer-login", "Division viewer login using division password"],
  ["GET", "/api/auth/me", "Return current authenticated user or null"],
  ["POST", "/api/auth/logout", "Delete session and clear cookie"],
  ["GET", "/api/files", "List accessible files by year/division"],
  ["GET", "/api/files/search", "Paginated advanced search"],
  ["POST", "/api/files/export/search", "Export searched file list as XLS/PDF"],
  ["GET", "/api/files/next-unique-code", "Generate next unique code for year/division"],
  ["GET", "/api/files/by-unique-code/:code", "Lookup file by unique code for barcode workflow"],
  ["GET", "/api/files/:id", "Load one file"],
  ["POST", "/api/files", "Create file with nested firms/orders/remarks/milestones"],
  ["PATCH", "/api/files/:id", "Patch file and optionally nested child data"],
  ["DELETE", "/api/files/:id", "Archive for non-admins, hard delete for admins"],
  ["GET", "/api/files/archive/list", "Admin archived file list"],
  ["DELETE", "/api/files/archive/:id", "Admin permanent delete of archived file"],
  ["POST", "/api/files/:id/restore", "Admin restore archived file"],
  ["GET", "/api/dashboard/summary", "Permission-scoped dashboard summary"],
  ["GET", "/api/reports/summary", "Permission-scoped report summary"],
  ["POST", "/api/exports/table", "Generic table export"],
  ["GET", "/api/divisions", "List divisions for financial year"],
  ["POST", "/api/divisions", "Admin create division/year allocation"],
  ["PATCH", "/api/divisions/:id", "Admin update division/allocation/viewer password"],
  ["DELETE", "/api/divisions/:id", "Admin archive division"],
  ["GET", "/api/divisions/archive/list", "Admin archived divisions"],
  ["POST", "/api/divisions/:id/restore", "Admin restore division"],
  ["DELETE", "/api/divisions/archive/:id", "Admin permanent delete division"],
  ["POST", "/api/divisions/merge", "Admin merge divisions and move active files"],
  ["POST", "/api/divisions/split-transfer", "Admin transfer indentors/files/allocations"],
  ["GET", "/api/indentors", "Paginated indentor search"],
  ["POST", "/api/indentors", "Create indentor"],
  ["PATCH", "/api/indentors/:id", "Admin/sub-admin update indentor"],
  ["DELETE", "/api/indentors/:id", "Admin/sub-admin delete indentor"],
  ["GET", "/api/messages", "List scoped messages"],
  ["POST", "/api/messages", "Viewer/division user creates query"],
  ["POST", "/api/messages/:id/replies", "Editor/admin replies"],
  ["POST", "/api/messages/:id/resolve", "Editor/admin resolves"],
  ["POST", "/api/messages/:id/view", "Mark message viewed"],
  ["DELETE", "/api/messages/:id", "Soft-delete message"],
  ["GET", "/api/settings", "Load settings and user preferences"],
  ["PATCH", "/api/settings", "Update settings/preferences"],
  ["POST", "/api/settings/financial-years", "Admin add year"],
  ["DELETE", "/api/settings/financial-years/:label", "Admin delete unused year"],
  ["GET", "/api/users", "Admin list users"],
  ["POST", "/api/users", "Admin create user"],
  ["PATCH", "/api/users/:id", "Admin update user"],
  ["DELETE", "/api/users/:id", "Admin delete user"],
  ["GET", "/api/live/mmg", "Public live MMG summary"],
];

const tableRows = [
  ["divisions", "id", "name, code, allocations, AD flag, viewer password hash, archive metadata", "Referenced by files, users, indentors, sessions, messages"],
  ["app_users", "id", "name, username, role, password_hash, is_active", "Linked to sessions and user_divisions"],
  ["user_divisions", "user_id + division_id", "User-to-division access map", "Many-to-many RBAC scope"],
  ["auth_sessions", "id", "token_hash, user_id or viewer_division_id, expires_at", "Cookie session backing store"],
  ["app_settings", "id=true", "financial years, theme, deletion password, milestones, presets, MMG settings", "Singleton configuration"],
  ["files", "id", "Core file/procurement metadata, lifecycle dates, values, current milestone, archive fields", "Central domain entity"],
  ["file_firms", "id", "Invited/bidder firm rows", "Many child rows per file"],
  ["supply_orders", "id", "Supply order, delivery, BG, IR, bill and payment fields", "Many child rows per file"],
  ["file_remarks", "id", "Section remarks with creation timestamp", "Many child rows per file"],
  ["file_completed_milestones", "file_id + milestone", "Completed milestone names", "Many-to-one file lifecycle state"],
  ["file_year_activity", "file_id + financial_year", "Active/closed status by financial year", "Multi-year retention"],
  ["financial_years", "label", "Known financial year labels", "Settings and reports"],
  ["division_year_allocations", "id", "Per-year capital/revenue allocation and active flag", "Division planning"],
  ["tcec_committees", "id", "Financial-year TCEC committee names", "Add-file options"],
  ["value_threshold_levels", "id", "Yearly value threshold levels", "Analytics"],
  ["indentors", "id", "Division indentor master data", "File and split-transfer workflows"],
  ["division_merges", "id", "Merge metadata", "Division restructuring history"],
  ["division_merge_sources", "merge_id + source_division_id", "Merge source divisions", "Merge details"],
  ["file_division_history", "id", "From/to division movements", "Audit-like movement history"],
  ["file_messages", "id", "Viewer queries, status, viewed/deleted/resolved data", "Message workflow"],
  ["file_message_replies", "id", "Editor/admin replies", "Message workflow"],
  ["user_table_field_presets", "owner_key", "Personal table presets", "Search/table customization"],
  ["user_live_status_preferences", "owner_key", "Live status field preferences", "Dashboard preferences"],
];

const indexes = [
  "Primary keys use UUIDs generated by pgcrypto.",
  "files.unique_code has a partial unique index where code is non-empty.",
  "files(year, created_at desc) and files(division_id, created_at desc) partial indexes support active file listing.",
  "GIN trigram indexes exist for file title, file number, IMMS, demand description, indentor, division name, firm names, supply-order firm, remarks, and indentor text fields.",
  "Lifecycle and report indexes include bid opening dates, CFA date, delivery due, payment due, BG return due, supply-order dates, and value fields.",
  "auth_sessions is indexed by user, viewer division, token hash uniqueness, and expiry time.",
  "file_year_activity(financial_year, status, file_id) supports multi-year filtering.",
  "file_completed_milestones(lower(milestone), file_id) supports milestone filters.",
];

const implementedFeatures = [
  "Staff login, viewer login, logout, and current-user detection",
  "HTTP-only cookie sessions backed by hashed tokens in PostgreSQL",
  "Roles: admin, sub_admin, editor, division_user, viewer",
  "Division-scoped access control for files, messages, indentors, dashboard, reports, and search",
  "File create, edit, soft archive, restore, and admin permanent delete",
  "Nested file data for invited firms, bidder firms, supply orders, remarks, active years, and completed milestones",
  "Advanced search with text, date, value, mode, milestone, dashboard, analytics, and cancellation filters",
  "Pagination for file search and indentor search",
  "Search and table export to Excel-compatible HTML and generated PDF",
  "Dashboard summary, status flow, live status rows, analytics, and finance totals",
  "Reports summary including status tables, cash outgo reports, delay rows, and historical ranges",
  "In-memory TTL caching for auth, settings, divisions, lookups, dashboard summaries, and report summaries",
  "Unique-code generation and unique-code lookup used by Quick Entry barcode-assisted retrieval",
  "Quick Entry workflow that scans/types a unique code and opens the current milestone section",
  "Division management, yearly allocations, division archive/restore, merge, and split-transfer",
  "Indentor master data management and search",
  "Viewer/editor message workflow with replies, resolve, viewed timestamp, and soft delete",
  "Settings for financial years, theme, milestones, TCEC committees, value thresholds, table presets, MMG live, and MMG summary fields",
  "Public MMG live page with periodic refresh",
  "Health and client IP endpoints",
];

const plannedFeatures = [
  "Dedicated audit logging table for every create/update/delete action",
  "Notification delivery through email, SMS, or in-app unread counters beyond the current message workflow",
  "Mobile application or camera-native scanning experience",
  "Cloud deployment automation with managed PostgreSQL",
  "Document attachment storage and OCR indexing",
  "Redis or distributed cache for multi-application-server deployment",
  "Read replicas for heavy analytical reporting",
  "Formal automated test suite and load-test reports",
];

const analysisMarkdown = `# File History Codebase Analysis

## Frontend Folder Structure

\`\`\`
${frontendStructure}
\`\`\`

## Backend Folder Structure

\`\`\`
${backendStructure}
\`\`\`

## Database Tables and Relationships

${tableRows.map((r) => `- **${r[0]}**: primary key ${r[1]}; ${r[2]}; ${r[3]}.`).join("\n")}

## Database Indexes

${indexes.map((item) => `- ${item}`).join("\n")}

## API Routes

${apiRows.map((r) => `- ${r[0]} ${r[1]} - ${r[2]}`).join("\n")}

## Implemented Features

${implementedFeatures.map((item) => `- ${item}`).join("\n")}

## Missing or Planned Features

${plannedFeatures.map((item) => `- ${item}`).join("\n")}

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
`;

fs.writeFileSync(analysisFile, analysisMarkdown);

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function r(text, opts = {}) {
  const props = [];
  if (opts.bold) props.push("<w:b/>");
  if (opts.italic) props.push("<w:i/>");
  if (opts.font) props.push(`<w:rFonts w:ascii="${opts.font}" w:hAnsi="${opts.font}"/>`);
  if (opts.size) props.push(`<w:sz w:val="${opts.size * 2}"/>`);
  return `<w:r>${props.length ? `<w:rPr>${props.join("")}</w:rPr>` : ""}<w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
}

function p(text = "", style = "Normal", opts = {}) {
  const jc = opts.center ? '<w:jc w:val="center"/>' : opts.right ? '<w:jc w:val="right"/>' : "";
  const pageBreak = opts.pageBreakBefore ? "<w:pageBreakBefore/>" : "";
  return `<w:p><w:pPr><w:pStyle w:val="${style}"/>${jc}${pageBreak}</w:pPr>${r(text, opts)}</w:p>`;
}

function code(text) {
  return String(text)
    .split("\n")
    .map((line) => `<w:p><w:pPr><w:pStyle w:val="Code"/></w:pPr>${r(line, { font: "Courier New", size: 9 })}</w:p>`)
    .join("");
}

function bullet(text) {
  return `<w:p><w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>${r(text)}</w:p>`;
}

function table(rows) {
  const grid = rows[0]?.map(() => '<w:gridCol w:w="2400"/>').join("") ?? "";
  return `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/><w:tblLook w:firstRow="1" w:noHBand="0" w:noVBand="1"/></w:tblPr><w:tblGrid>${grid}</w:tblGrid>${rows
    .map((row, rowIndex) => `<w:tr>${row
      .map((cell) => `<w:tc><w:tcPr><w:tcW w:w="2400" w:type="dxa"/>${rowIndex === 0 ? '<w:shd w:fill="D9EAF7"/>' : ""}</w:tcPr>${p(cell, "TableText", { bold: rowIndex === 0 })}</w:tc>`)
      .join("")}</w:tr>`)
    .join("")}</w:tbl>`;
}

function toc() {
  return `<w:p><w:pPr><w:pStyle w:val="TOCHeading"/></w:pPr>${r("Table of Contents", { bold: true, size: 16 })}</w:p>
<w:p>${r("Right-click this table in Microsoft Word and choose Update Field to refresh page numbers.", { italic: true })}</w:p>
<w:p><w:fldSimple w:instr='TOC \\o "1-3" \\h \\z \\u'><w:r><w:t>Table of contents will be generated by Word.</w:t></w:r></w:fldSimple></w:p>`;
}

const figures = [
  "Login Page",
  "Dashboard",
  "Add File Page",
  "Search Page",
  "Barcode Scanner / Quick Entry",
  "Reports Page",
  "Archive Page",
  "User Management Page",
];

function figurePlaceholder(n, title) {
  return table([
    [`Screenshot Placeholder: ${title}`],
    [`Figure ${n}: ${title} screenshot placeholder. Insert the actual application screenshot here during final formatting.`],
  ]);
}

function chapter(num, title) {
  return p(`CHAPTER ${num} - ${title}`, "Heading1", { pageBreakBefore: true });
}

const doc = [];
doc.push(p("File History", "Title", { center: true, bold: true, size: 24 }));
doc.push(p("File Management and Archival System", "Subtitle", { center: true, bold: true, size: 18 }));
doc.push(p("A Major Project Report", "Normal", { center: true, size: 14 }));
doc.push(p("Submitted in partial fulfilment of the requirements for the degree of Bachelor of Technology in Computer Science Engineering", "Normal", { center: true }));
doc.push(p("Technology Stack: React, TypeScript, Tailwind CSS, Express.js, TypeScript, PostgreSQL", "Normal", { center: true }));
doc.push(p("Generated from verified codebase analysis", "Normal", { center: true, italic: true }));

doc.push(p("Certificate", "Heading1", { pageBreakBefore: true }));
doc.push(p("This is to certify that the project report titled File History - File Management and Archival System represents a full-stack software engineering project developed for digital management of office file records. The report has been prepared using verified implementation details observed in the supplied codebase, including the frontend routes, backend APIs, PostgreSQL migrations, authentication design, authorization model, caching approach, and deployment-related configuration."));
doc.push(p("Declaration", "Heading1", { pageBreakBefore: true }));
doc.push(p("I hereby declare that this project report is based on the implementation of the File History system. The technical descriptions in this report distinguish implemented functionality from future enhancements. Wherever capacity planning is discussed, it is presented as design analysis for an internal organizational deployment rather than as a measured load-test result."));
doc.push(p("Acknowledgement", "Heading1", { pageBreakBefore: true }));
doc.push(p("I express sincere gratitude to the faculty members, mentors, reviewers, and users whose guidance helped shape this project. The system reflects practical software engineering concerns such as maintainability, secure access, database normalization, efficient search, administrative workflows, and long-term record retention."));
doc.push(p("Abstract", "Heading1", { pageBreakBefore: true }));
doc.push(p("File History is a full-stack web application for indexing, searching, tracking, archiving, and managing physical office file records through a centralized digital platform. The verified implementation uses a React and TypeScript frontend with TanStack Router, Tailwind CSS, and reusable component primitives. The backend is an Express.js TypeScript REST API connected to PostgreSQL through a pooled pg client. The system implements cookie-based authentication, role-based and division-based authorization, file lifecycle management, advanced SQL-backed search, reporting, dashboard analytics, unique-code based quick entry, archival workflows, message handling, division and financial-year administration, and in-memory caching."));
doc.push(p("The project is designed for an internal office environment with capacity-planning assumptions of 500-600 registered users, approximately 100 active editors, 200-300 file modifications per day, multiple divisions, standard office operating hours, and multi-year data retention. The current implementation is suitable for a single application-server deployment backed by PostgreSQL, with clear future paths toward Redis, load balancing, read replicas, and managed backup automation."));
doc.push(toc());
doc.push(p("List of Figures", "Heading1", { pageBreakBefore: true }));
figures.forEach((f, i) => doc.push(p(`Figure ${i + 1}: ${f} screenshot placeholder`)));
doc.push(p("List of Tables", "Heading1", { pageBreakBefore: true }));
["Existing System Comparison", "API Route Inventory", "Database Table Summary", "Indexing Strategy", "Role Permission Matrix", "Testing Matrix", "Implemented vs Planned Features"].forEach((t, i) => doc.push(p(`Table ${i + 1}: ${t}`)));

doc.push(chapter(1, "INTRODUCTION"));
doc.push(p("Organizations that maintain large numbers of physical procurement, administrative, and departmental files often face a practical information-management problem: the physical file may remain in cupboards, tables, sections, or departments, while the knowledge of where it is, what stage it has reached, and what action is pending remains distributed among people. File History addresses this problem by creating a centralized digital index around physical records. It does not attempt to replace every paper file with a scanned document repository. Instead, it digitizes the metadata, lifecycle, search, reporting, allocation, and accountability layers that make physical files discoverable and manageable."));
doc.push(p("The implemented system is highly relevant to office environments where files progress through repeated administrative stages such as scrutiny, controlling, approvals, bidding, supply order, delivery, bank guarantee, billing, and payment. The codebase shows a domain-specific file model rather than a generic document list. Each file can store values, divisions, indentors, milestone dates, firms, supply orders, remarks, completed milestones, active financial years, and current milestone state. This makes the system useful for operational monitoring as well as historical retrieval."));
doc.push(p("From a software engineering perspective, the project demonstrates a layered web architecture. The frontend is responsible for user interaction, route-level workflows, local state subscriptions, table customization, and request orchestration. The backend centralizes authentication, authorization, validation, database access, cache control, SQL search construction, reporting, and export generation. PostgreSQL provides relational integrity, indexing, transaction support, JSONB configuration storage, trigram search support, and cryptographic extensions for password hashing."));
doc.push(figurePlaceholder(1, "Login Page"));

doc.push(chapter(2, "PROBLEM STATEMENT"));
doc.push(p("Manual record management creates a gap between physical possession of a file and organizational visibility of its state. In traditional workflows, a file may be known only to the person or division currently handling it. When staff members change roles, are absent, or manage a high volume of records, file discovery becomes slow and error-prone. The codebase reflects this problem domain by storing searchable identifiers such as unique code, file number, IMMS number, indentor, demand description, division, firm, dates, values, and milestone status."));
doc.push(p("Spreadsheet-based tracking improves visibility but introduces its own weaknesses. Concurrent editing is difficult to control, role-based access is usually weak, auditability is limited, and complex reporting requires repeated manual filtering. Spreadsheet formulas also become fragile as record volume grows. File History replaces this with a centralized API, database constraints, role checks, division scope conditions, parameterized SQL search, and consistent pagination."));
doc.push(p("Archival is another major problem. Manual systems often mix active, closed, cancelled, and historical records in the same register. The implementation solves this through archived_at fields on files and divisions, archive listing APIs, restore APIs, and permanent deletion guarded by a configured deletion password. Non-admin file deletion archives instead of immediately deleting, which reduces accidental data loss."));
doc.push(table([["Problem", "Manual / Spreadsheet Impact", "Implemented Response"], ["File discovery", "Requires physical register or staff memory", "Advanced search and unique-code lookup"], ["Access control", "Informal or all-or-nothing", "Role and division scoped APIs"], ["Reporting", "Manual aggregation", "Dashboard and reports summary APIs"], ["Archival", "Mixed active and old data", "Soft archive, restore, permanent delete"], ["Concurrency", "Conflicting edits", "Central database and transactions"]]));

doc.push(chapter(3, "OBJECTIVES"));
["Centralize the digital index of physical office files.", "Provide faster retrieval through structured filters, free text search, date filters, value filters, and unique-code lookup.", "Support secure access through authenticated sessions, role checks, and division scope checks.", "Maintain normalized relational storage for long-term maintainability.", "Improve reporting through dashboard summaries, status flow, cash outgo reports, delay reports, and export support.", "Support multi-year operations through financial-year tables and file year activity.", "Protect historical data through archival and restore workflows.", "Enable operational efficiency through Quick Entry barcode-assisted lookup."].forEach((item) => doc.push(bullet(item)));

doc.push(chapter(4, "EXISTING SYSTEM ANALYSIS"));
doc.push(p("The existing alternatives for an office file environment can be grouped into paper registers, spreadsheet trackers, and informal departmental logs. Paper registers are simple and require no infrastructure, but they cannot support multi-user search, permission-scoped reporting, or analytics. Spreadsheet systems allow filtering and formulas but are weak at concurrent updates, structured authorization, relational consistency, and long-term schema evolution. Traditional record-tracking applications may provide CRUD operations but often do not model domain-specific procurement stages, division-year allocation, supply-order child records, or operational dashboards."));
doc.push(table([["System", "Advantages", "Limitations"], ["Paper register", "Low cost, familiar process", "Slow search, no centralized reports, no access control"], ["Spreadsheet", "Easy to start, searchable columns", "Weak concurrency, weak permissions, fragile formulas"], ["Generic file tracker", "Basic CRUD and search", "Often lacks domain lifecycle and reporting"], ["File History", "Centralized, scoped, searchable, reportable", "Requires server, database, backups, and user training"]]));

doc.push(chapter(5, "PROPOSED SYSTEM"));
doc.push(p("The proposed and implemented system is a web-based file indexing and archival system. The frontend provides authenticated routes for dashboard, search, add/edit, quick entry, reports, messages, settings, divisions, and year setup. The backend exposes REST APIs under /api and acts as the authoritative layer for access control, SQL query construction, persistence, and reporting. PostgreSQL stores the normalized operational data."));
doc.push(p("The most important improvement over manual systems is that the file record becomes queryable by many dimensions. Users can search by division, indentor, financial year, demand description, firm, value range, supply-order value range, modes, TCEC/GTE/AD/RQA/IFA/BG/RFP flags, DP date ranges, cancellation status, dashboard-derived filters, and free text. The search implementation is not merely client-side filtering; the main path composes parameterized SQL with LIMIT and OFFSET."));
doc.push(figurePlaceholder(2, "Dashboard"));

doc.push(chapter(6, "REQUIREMENT ANALYSIS"));
doc.push(p("Functional requirements verified in the codebase include login, viewer login, logout, file creation, file update, file retrieval, search, search export, unique-code generation, unique-code lookup, archive list, restore, permanent delete, division management, user management, settings management, financial-year management, indentor management, dashboard summary, report summary, table export, message creation, message reply, message resolve, and live summary display."));
doc.push(table([["Requirement Type", "Verified Requirement"], ["Functional", "CRUD and archival workflow for file records"], ["Functional", "Advanced paginated search and export"], ["Functional", "Dashboard, reports, messages, indentors, users, divisions, settings"], ["Security", "Session cookies, role checks, division scope"], ["Performance", "Indexes, pagination, connection pooling, cache TTLs"], ["Scalability", "Normalized schema, permission-scoped summaries, pool max 30"], ["Maintainability", "Typed frontend/backend modules and route separation"]]));

doc.push(chapter(7, "SYSTEM ARCHITECTURE"));
doc.push(p("The architecture visible in the code is a layered client-server architecture. The React frontend communicates with an Express REST backend using fetch with credentials included. The backend attaches an authenticated user to each request by reading the HTTP-only session cookie and loading the session from PostgreSQL. Route handlers then call authorization helpers and construct database queries through the pg pool. Data is returned as JSON for interactive screens or as generated XLS/PDF content for exports."));
doc.push(code(`Users / Browsers
      |
      v
React + TypeScript Frontend
TanStack Router, Tailwind CSS, local store
      |
      | HTTPS/HTTP REST requests with credentials
      v
Express.js API Layer
Routes, auth helpers, validation, cache, reports
      |
      | pg Pool (max 30)
      v
PostgreSQL Database
Tables, indexes, constraints, pgcrypto, pg_trgm`));
doc.push(p("The frontend is organized around route modules. __root.tsx implements the shell, login screen, auth gate, error boundary, and public live page exception. The add route implements the largest workflow: file creation, editing, section navigation, milestone management, firm details, supply orders, remarks, timeline reports, and conditional form behavior. The search route implements advanced filters, pagination, table presets, selected rows, inline editing, and print/export helpers. The dashboard route reuses the Dashboard implementation from index.tsx. Reports, settings, messages, quick-entry, divisions, mmg-live, and year-setup each represent major application workflows."));
doc.push(p("The backend is route-oriented. server.ts creates the Express application, configures CORS, JSON parsing, auth attachment, route mounting, and centralized error handling. Each route file owns a bounded API area. Utility modules hold reusable logic for auth, cache, exports, HTTP errors, database value conversion, dashboard summaries, report summaries, and legacy file search."));
doc.push(code(`Request Lifecycle
Browser event
  -> frontend store or route fetch
  -> /api endpoint with credentials
  -> CORS and JSON middleware
  -> attachAuthUser()
  -> route-specific requireAuth/requireAdmin/canAccessDivision
  -> parameterized SQL through pg Pool
  -> optional cache read/write
  -> JSON or file response
  -> frontend state update and UI render`));
doc.push(p("React was a suitable frontend choice because the system has many stateful screens, conditional controls, and componentized tables. TypeScript is used across frontend and backend to reduce mismatch between file fields, roles, settings, and API payloads. Express is appropriate for the current scale because the API is REST-oriented and route handlers remain understandable. PostgreSQL was selected implicitly and practically because the system is relational, needs transactions, indexes, UUIDs, constraints, JSONB settings, and extensions such as pgcrypto and pg_trgm."));
doc.push(p("Maintainability is supported through clear separation of concerns: UI routes do not directly access the database, backend routes centralize authorization, database migrations describe schema evolution, and cache invalidation is grouped into reusable prefix functions. Extensibility is visible in the use of child tables for supply orders, firms, remarks, messages, and milestones, which allows the file model to grow without forcing all repeated data into one wide table."));
doc.push(p("A notable architectural decision is the deliberate avoidance of an ORM in the backend. The route handlers and summary builders use explicit SQL, which makes the database access layer more verbose but also more transparent. For this application, explicit SQL is beneficial because the system has specialized filters such as milestone eligibility, delivery period status, cash outgo estimation, cancellation logic, active-year visibility, and division-scope predicates. These are easier to optimize and reason about when the SQL is visible and can be aligned directly with indexes."));
doc.push(p("The backend also demonstrates a bounded form of service decomposition without introducing microservices. Each route file owns one operational capability, but all routes run in one Express process. This is a sensible decision for the current organizational scale because it avoids distributed-system complexity while preserving modularity at the source-code level. If the system later grows, the clearest extraction candidates would be reporting/export generation and public live dashboards, because those can be read-heavy and can tolerate separate caching strategies."));
doc.push(p("The request lifecycle makes authorization part of the core path rather than an optional UI behavior. attachAuthUser runs before route mounting, so each route can rely on request.authUser after requireAuth. Division filtering is converted into SQL through getDivisionScopeCondition, which means inaccessible rows are not merely hidden after retrieval; they are excluded from the query itself. This design reduces accidental data exposure and improves performance for restricted users because fewer rows are scanned and returned."));
doc.push(p("The frontend architecture follows the same practical philosophy. It does not over-fragment every screen into tiny files; instead, major domain workflows are concentrated in route modules. Although some route files are large, they correspond to complex screens with many tightly related controls. This is acceptable for a university project and an internal tool, but future maintainability would benefit from extracting reusable subcomponents from add.tsx, search.tsx, index.tsx, reports.tsx, and settings.tsx once the workflow stabilizes."));
doc.push(figurePlaceholder(3, "Add File Page"));

doc.push(chapter(8, "DATABASE DESIGN"));
doc.push(p("The PostgreSQL design combines a central files table with normalized child tables. This is a pragmatic hybrid design. The files table contains many first-order lifecycle fields because the office workflow has numerous date and status columns that are frequently filtered and displayed. Repeating groups are normalized into child tables: invited/bidder firms, supply orders, remarks, completed milestones, year activity, messages, and replies. Administrative data is separated into divisions, users, user_divisions, settings, financial years, yearly allocations, TCEC committees, value thresholds, indentors, and division restructuring tables."));
doc.push(code(`divisions 1---* files
divisions *---* app_users through user_divisions
files 1---* file_firms
files 1---* supply_orders
files 1---* file_remarks
files 1---* file_completed_milestones
files 1---* file_year_activity
files 1---* file_messages 1---* file_message_replies
divisions 1---* indentors
divisions 1---* division_year_allocations
app_users 1---* auth_sessions
divisions 1---* auth_sessions for viewer sessions`));
doc.push(table([["Table", "Primary Key", "Purpose", "Relationships"], ...tableRows]));
doc.push(p("Keys and constraints are used throughout the schema. Most domain tables use UUID primary keys generated by gen_random_uuid. user_divisions uses a composite primary key to prevent duplicate user-division assignments. file_completed_milestones uses file_id plus milestone as its primary key. auth_sessions has a unique token_hash and a check constraint requiring either user_id or viewer_division_id. Several tables enforce valid enumerations through check constraints, including user roles, theme values, firm type, file year activity status, value threshold applies_to, and message status."));
doc.push(p("Indexing is a major implementation decision. The schema includes basic B-tree indexes for years, divisions, created timestamps, current milestones, mode, pending payment dates, delivery dates, archive fields, auth sessions, financial years, and child-table foreign keys. It also enables pg_trgm and creates GIN trigram indexes for text-heavy search fields. Later migrations add partial and expression indexes for active file listing, uppercase mode filtering, lower-case indentor search, bid dates, supply-order due dates, payment due, BG return due, values, remarks, and indentor fields."));
indexes.forEach((item) => doc.push(bullet(item)));
doc.push(p("PostgreSQL is a strong fit because the application requires joins, transactions, referential integrity, generated UUIDs, partial indexes, expression indexes, JSONB configuration, and extension-based capabilities. The backend also uses PostgreSQL crypt and gen_salt for password hashing and cryptographic verification, which avoids storing raw passwords and keeps verification close to the database."));
doc.push(p("The files table is intentionally wide because many lifecycle attributes are first-class search and report fields. A fully generic key-value schema would reduce the number of columns, but it would make typed validation, date comparisons, value-range filters, and index design more difficult. The current design accepts a wider table in exchange for direct SQL filters, stable column names, and simpler report expressions. Repeating data is still normalized where it matters: supply orders, firms, remarks, messages, milestones, and year activity are separate tables."));
doc.push(p("The schema also shows an evolutionary migration pattern. Early migrations create the base schema, while later migrations add authentication and archival fields, financial years, yearly division allocations, file-year activity, division merge history, indentors, search indexes, live status preferences, messages, MMG live settings, IR dates, bill preparation dates, and MMG summary settings. This reflects realistic software development: the database was not treated as static, but as a versioned component that adapts as organizational requirements become clearer."));
doc.push(p("Relationship design supports both operational and historical needs. file_year_activity allows a file to be visible in more than one financial year without duplicating the file. division_year_allocations allows a division's capital/revenue allocation and active status to change by year. file_division_history records movement caused by merges or split-transfer workflows. These tables are important because office record systems often outlive one financial period and must preserve context as divisions reorganize."));
doc.push(p("The indexing strategy is not limited to primary keys and foreign keys. It includes indexes that directly match business questions: which files are active this year, which supply orders have pending delivery, which bills are pending payment, which bank guarantees should be returned, which files are filtered by indentor or firm, and which messages are pending or resolved. This is a strong database-engineering feature because it shows that performance is handled through schema design, not only through application caching."));

doc.push(chapter(9, "FRONTEND DESIGN"));
doc.push(p("The frontend uses React and TypeScript with TanStack Router. Routes are file-based and strongly organized around application workflows. The root route loads global CSS, metadata, the QueryClient provider, the TopBar, authentication-gated layout, public MMG live exception, login screen, and error/not-found screens. The application store in files-store.ts encapsulates backend communication and exposes hooks such as useSettings, useDivisions, useActiveUser, useMessages, and helper fetch functions."));
doc.push(code(frontendStructure));
doc.push(p("State management is implemented through a lightweight custom store with React subscription hooks. The store loads authentication state, settings, divisions, messages, and admin-only users. It uses fetch with credentials included and centralizes JSON error handling. Route-specific screens also maintain local state for filters, drafts, pagination, active tabs, selected rows, and form sections. React Query is initialized in the router context, while much of the current data flow is handled by the custom store and route-level fetch logic."));
doc.push(p("User experience decisions visible in the code include separate staff/viewer login modes, display of client IP on login, Quick Entry for scanned codes, route-level pagination, table field presets, live dashboards, archive management, and admin-only settings sections. The frontend emphasizes operational workflows rather than a marketing-style landing page."));
doc.push(figurePlaceholder(4, "Search Page"));

doc.push(chapter(10, "BACKEND DESIGN"));
doc.push(p("The backend uses Express with TypeScript. server.ts configures CORS based on FRONTEND_ORIGIN, allows localhost and 192.168.x.x origins during development, accepts JSON bodies up to 15 MB, attaches auth user information, mounts route modules, and uses a centralized error handler that converts HttpError instances into HTTP status codes and JSON error messages."));
doc.push(code(backendStructure));
doc.push(p("Route handlers perform validation through helper functions such as requireObjectBody, requireString, and requireParam. Database access uses parameterized SQL through pg Pool. Multi-step mutations such as file create/update, division merge, split-transfer, user create/update, and nested file-data replacement use explicit transactions where consistency matters. The codebase does not introduce a separate ORM; this gives the developers precise control over SQL, indexes, joins, reporting, and search expressions."));
doc.push(p("Business logic is placed partly in route files and partly in utility modules. The files route owns file field mapping, child loading, search SQL construction, nested data replacement, and archive rules. Dashboard and reports routes combine SQL summary builders with settings and division context. Auth utilities centralize session loading and permission helpers. Cache utilities centralize TTL behavior and prefix invalidation."));

doc.push(chapter(11, "AUTHENTICATION AND AUTHORIZATION"));
doc.push(p("Authentication is implemented with HTTP-only cookie sessions. On staff login, the backend checks app_users where username matches case-insensitively, the user is active, password_hash is present, and password_hash equals crypt(submittedPassword, password_hash). On success, the backend creates a random 32-byte base64url token, stores its SHA-256 hash in auth_sessions with a seven-day expiry, and sets the recordkeeper_session cookie."));
doc.push(p("Viewer login is a separate workflow. A viewer selects a division and enters that division's viewer password. The backend validates divisions.viewer_password_hash through crypt, creates a session with viewer_division_id rather than user_id, and returns an AuthUser with role viewer and one division scope. This is an important design decision because it allows read/query access for a division without creating a normal staff account."));
doc.push(code(`Login Sequence
User submits credentials
  -> POST /api/auth/login or /api/auth/viewer-login
  -> PostgreSQL crypt password verification
  -> random token generated
  -> SHA-256 token hash inserted into auth_sessions
  -> HTTP-only recordkeeper_session cookie set
  -> frontend reloads user/settings/divisions/messages`));
doc.push(table([["Role", "Verified Access"], ["admin", "All divisions, user management, settings, archive restore/permanent delete"], ["sub_admin", "All divisions for file mutation and summaries; selected admin-like operations where allowed"], ["editor", "Can add/edit/delete files within allowed divisions"], ["division_user", "Scoped division access and viewer-style message creation"], ["viewer", "Scoped read/message workflow through division viewer login"]]));

doc.push(chapter(12, "SEARCH AND FILTERING SYSTEM"));
doc.push(p("Search is one of the most engineered parts of the implementation. The frontend search route exposes filters for year, indentor, division, values, supply-order values, capital/revenue flags, description, firm, modes, high value, GTE, AD, RQA, IFA, PSB, BG, RFP vetting, refloat, CNC, TCEC, delivery-period dates, RST, cancellations, free text, free date, sorting, division-wise sorting, page, and page size. The backend reads these query parameters and builds SQL with parameter placeholders."));
doc.push(p("The backend caps pageSize at 500 and computes LIMIT/OFFSET. It supports dashboard-derived filters such as milestone status, delivery, BG return, payment due, IR pending/completed, cash outgo, and delay status. It also includes child-table EXISTS expressions for supply_orders, file_firms, file_remarks, file_completed_milestones, and file_year_activity. This means search results can reflect the full file lifecycle, not only columns directly on files."));
doc.push(p("Security and performance are connected in this design. Query values are stored in an array and inserted as numbered placeholders, reducing SQL injection risk. Search fields are mapped from known frontend keys to fixed SQL columns, preventing arbitrary user-selected SQL. The schema includes B-tree, partial, expression, and trigram indexes that match common search access patterns."));

doc.push(chapter(13, "BARCODE MANAGEMENT SYSTEM"));
doc.push(p("The implemented barcode workflow is unique-code based. The backend exposes /api/files/next-unique-code, which generates a code from the selected financial year and division code, then appends a zero-padded serial. It also exposes /api/files/by-unique-code/:code for lookup. The Quick Entry frontend route asks the user to scan a file barcode or type the unique code, normalizes the input, performs lookup, verifies that exactly one accessible file matches, and navigates to the add/edit route focused on the current milestone section."));
doc.push(code(`Quick Entry Sequence
Editor scans barcode or types unique code
  -> frontend normalizes code
  -> GET /api/files/by-unique-code/:code
  -> backend applies division scope
  -> one matching file returned
  -> frontend maps current milestone to section
  -> /add opens with fileId, section, quickFocus`));
doc.push(figurePlaceholder(5, "Barcode Scanner / Quick Entry"));

doc.push(chapter(14, "DASHBOARD AND REPORTING MODULE"));
doc.push(p("The dashboard module is implemented through /api/dashboard/summary. It loads settings, divisions, value threshold levels, applies selected year and division context, builds permission-scoped SQL where clauses, creates cache keys from scope and query parameters, and returns summary data. The frontend dashboard uses the summary for status flows, live status rows, analytics, mode counts, finance totals, and export/search actions."));
doc.push(p("The reports module is implemented through /api/reports/summary. It supports division selection, delay thresholds, expected cash outgo offsets, historical date ranges, cash outgo month selection, and selected year. The returned summary includes status summary groups, expected cash outgo rows, bill sent for payment rows, actual cash outgo rows, delay rows, and delay summary. The frontend reports route renders these data sets and supports export through the generic table export endpoint."));
doc.push(figurePlaceholder(6, "Reports Page"));

doc.push(chapter(15, "CACHING STRATEGY"));
doc.push(p("Caching is implemented in backend/src/utils/cache.ts as an in-memory Map with expiry timestamps. The TTL constants are authSessionMs 30000, settingsMs 60000, divisionsMs 60000, lookupMs 120000, dashboardSummaryMs 30000, and reportsSummaryMs 60000. Dashboard cache keys begin with dashboard:summary and include permission scope, selected year, division context, and live milestone options. Report cache keys begin with reports:summary and include permission scope, selected year, division, delay days, delay milestone, cash outgo dates, and historical ranges."));
doc.push(p("Invalidation is prefix-based. File mutations call clearDashboardReportCaches. Settings changes clear settings, divisions, and lookup prefixes. Division mutations clear auth, divisions, and selected-year lookup prefixes. User mutations clear auth and user lookup prefixes. This is appropriate for a single internal application server because data freshness requirements are moderate and the expected modification rate is 200-300 file changes per day."));
doc.push(p("Redis is not required in the current verified implementation because the application appears designed for one backend process and an internal deployment. In-memory caching has low operational complexity and no network hop. The trade-off is that cache state is local to one process; if the system later runs multiple application servers, Redis or another distributed cache would be required for consistent shared cache invalidation."));

doc.push(chapter(16, "SCALABILITY CONSIDERATIONS"));
doc.push(p("The capacity-planning assumption is 500-600 registered users, approximately 100 active editors, 200-300 file modifications per day, multiple divisions, standard office hours, and 5-10 years of retained records. The current architecture can support this class of workload because most user activity is read-heavy: dashboard views, search, reports, and lookups. Write volume is modest relative to PostgreSQL capability, and the backend uses a connection pool capped at 30 connections."));
doc.push(p("Connection pooling is important because 100 active editors do not require 100 database connections simultaneously. Web requests are short-lived, and the pg Pool reuses connections. A max of 30 is a reasonable internal deployment starting point, provided PostgreSQL is configured with adequate max_connections and the application is monitored. If concurrent report/search requests grow, the first bottleneck is likely database CPU or query latency rather than raw Node.js request handling."));
doc.push(p("Pagination reduces memory and network pressure. File search defaults to 100 rows and is capped at 500 rows. Indentor search defaults to 50 and caps at 200. Search export intentionally caps exported file rows at 5000. These caps prevent a single user action from loading the entire historical dataset into browser memory or overwhelming the backend."));
doc.push(p("Database growth over 5-10 years will primarily affect the files table and child tables such as supply_orders, file_remarks, file_year_activity, and file_messages. With 200-300 modifications per day, the number of rows may remain manageable for PostgreSQL if indexes are maintained and vacuum/analyze run normally. The schema's indexes target common filters, but future growth should be monitored with EXPLAIN ANALYZE on dashboard/report/search queries."));
doc.push(p("Future scaling options are clear. The frontend can be served statically behind Nginx or another web server. The backend can be replicated horizontally if sessions remain database-backed and cache moves to Redis. PostgreSQL can add read replicas for dashboard/report reads. Long-running reports can be moved to background jobs. Static and live dashboards can be cached at a gateway if freshness windows are acceptable."));
doc.push(p("For the assumed workload, write contention should remain low. Two hundred to three hundred file modifications per day averages to a small number of writes per hour, even if activity is concentrated during office hours. The more important workload is repeated reads: users opening search pages, dashboard cards, reports, messages, settings, and Quick Entry. The implemented cache TTLs therefore target summary and lookup reads rather than file writes. This matches the observed usage pattern of an office record system where many users consult information and fewer users modify it."));
doc.push(p("The application also limits operational risk through row-count boundaries. Search pagination prevents large result sets from being transferred to the browser. Export is capped to the first 5000 searched files, which protects the API from extremely large generated documents. Indentor search caps page size at 200. These caps are small but meaningful scalability controls because they prevent a single accidental broad query from dominating CPU, memory, or network bandwidth."));
doc.push(p("A likely future bottleneck is dashboard and report SQL complexity. The code builds sophisticated summaries involving milestones, supply orders, dates, cancellations, and division filters. Under larger data volumes, these queries should be monitored using PostgreSQL slow query logs and EXPLAIN ANALYZE. If a small number of reports becomes expensive, materialized views or scheduled summary tables would be appropriate. The current 30-second and 60-second caches delay that need at the expected internal-office scale."));
doc.push(p("Horizontal scaling is possible but requires one important change: the in-memory cache must become distributed. Sessions are already database-backed, so multiple Express servers can authenticate consistently. However, dashboard and report caches stored in local memory would diverge between nodes. Redis would solve shared cache storage and invalidation. A load balancer could then distribute browser requests across API servers, while PostgreSQL remains the consistency boundary."));
doc.push(p("Database scaling should begin with maintenance and query tuning rather than immediate sharding. The relational model is still well within the natural strengths of PostgreSQL for the stated workload. Recommended operational practices include regular VACUUM and ANALYZE, index bloat monitoring, backup verification, retention policies for sessions, and periodic review of unused indexes. Read replicas should be considered when reports become heavy enough to affect transactional searches and edits."));
doc.push(code(`Current Scale Path
Single frontend host/static server
Single Express API server
PostgreSQL primary database
In-memory cache

Future Scale Path
Load balancer
Multiple Express API servers
Redis distributed cache
PostgreSQL primary + read replicas
Background report/export workers`));

doc.push(chapter(17, "SECURITY CONSIDERATIONS"));
doc.push(p("Security is enforced at several layers. Authentication uses random session tokens, HTTP-only cookies, seven-day expiry, and SHA-256 token hashes in the database. Passwords are verified with PostgreSQL crypt and stored as salted hashes. Session cookies use SameSite configuration from SESSION_COOKIE_SAMESITE, default to lax, and are secure in production or when SameSite none is selected."));
doc.push(p("Authorization is centralized. requireAuth blocks anonymous access to protected APIs, requireAdmin limits administrative APIs, canMutateFiles allows admin/sub_admin/editor mutations, canUseAllDivisions grants admin/sub_admin broad scope, canAccessDivision checks division membership, and getDivisionScopeCondition generates SQL conditions to restrict result sets. This is important because frontend hiding alone would be insufficient; the backend applies scope at API and SQL levels."));
doc.push(p("SQL injection prevention is visible in the consistent use of parameterized queries. Search construction uses helper functions to add values to a values array and returns numbered placeholders. Sort and field filters are mapped from whitelisted keys to fixed SQL columns. User-provided strings are not directly used as arbitrary SQL column names. Request body validation rejects missing or malformed bodies, strings, arrays, and route parameters."));
doc.push(p("Data protection decisions include soft archive for non-admin file deletion, admin-only permanent deletion, deletion-password checks for permanent destructive actions, last-admin protection in user deletion/role change, archived divisions and files separated from active queries, and scoped message access. Error handling returns structured JSON but logs server-side errors to console."));
doc.push(p("The role model is intentionally asymmetric. Admin users have broad configuration and destructive authority; sub-admins and editors can mutate files but do not receive every administrative operation; viewers and division users are scoped to division-level access. This separation is important in an office environment because the person who needs to view or query a file should not necessarily be allowed to delete records, change global settings, or manage other users."));
doc.push(p("Division-based authorization is especially important because file records may contain departmental workload, procurement values, firms, dates, and internal status. The backend's canAccessDivision and getDivisionScopeCondition functions enforce this boundary on both single-record operations and list/report queries. The design avoids trusting frontend filters because a user could bypass UI controls and call APIs directly. Backend-enforced scope is therefore a necessary security control, not only a convenience."));
doc.push(p("The implementation also contains practical safeguards around destructive operations. A non-admin file delete does not immediately remove the row; it archives the file and records archived_at, archived_by, and an archive reason. Admins can permanently delete, but only after deletion-password verification. Division deletion similarly archives first, with separate archive list, restore, and permanent delete endpoints. This pattern reduces accidental data loss while still supporting cleanup when required."));
doc.push(p("Input validation is implemented through simple but consistent helpers. requireObjectBody prevents malformed JSON bodies, requireString enforces required string fields, requireParam validates route parameters, and specialized readers validate arrays, positive integers, theme values, roles, threshold levels, date formats, and export table shapes. This validation layer is not as formal as a full schema-per-route system, but it is visible and consistently applied across important endpoints."));
doc.push(p("Security limitations are also worth noting. The codebase does not show CSRF token protection, rate limiting, login throttling, audit logging, or automated vulnerability tests. SameSite cookies reduce CSRF exposure, and internal deployment lowers internet-facing risk, but a production hardening phase should add rate limiting, CSRF review, stronger password policy, HTTPS-only deployment, secure environment management, audit trails, and central log monitoring."));
doc.push(code(`Security Architecture
Browser
  -> HTTP-only session cookie
Express attachAuthUser
  -> auth_sessions token_hash lookup
Route authorization
  -> role checks + division checks
SQL layer
  -> parameterized queries + scope predicates
PostgreSQL
  -> constraints + foreign keys + password hashes`));

doc.push(chapter(18, "DEPLOYMENT ARCHITECTURE"));
doc.push(p("The verified codebase is consistent with an internal office deployment. The backend listens on 0.0.0.0 at the configured PORT or 3000. CORS allows configured FRONTEND_ORIGIN values and, in non-production mode, localhost and 192.168.x.x origins with dynamic ports. This is suitable for LAN testing and internal access. The frontend reads VITE_API_BASE_URL and sends requests with credentials included."));
doc.push(code(`Office LAN Deployment
Employee Browser
  -> Frontend URL
  -> API URL /api/*
Application Server
  - Vite/static frontend or separate web server
  - Express backend on PORT
Database Server
  - PostgreSQL with schema migrations
Backup Storage
  - scheduled pg_dump/base backups`));
doc.push(p("PostgreSQL must be deployed with persistent storage, regular backups, and controlled access from the application server. The BACKUP_AND_RECOVERY and UBUNTU_LAN_DEPLOYMENT documents in the repository indicate deployment and recovery concerns are already part of the project context. A production deployment should add service supervision, environment-file protection, database backup verification, log rotation, and monitoring for disk usage, connection count, slow queries, and application errors."));
doc.push(p("Reliability planning should include database backups, periodic restore drills, application process restart policy, health endpoint monitoring, and a rollback plan for migrations. Since the application is internal and modification volume is moderate, a single primary PostgreSQL server with frequent backups is acceptable initially. For higher availability, a standby database or managed PostgreSQL service can be introduced."));
doc.push(p("The deployment boundary should separate configuration from code. The backend requires DATABASE_URL and optionally PORT, NODE_ENV, FRONTEND_ORIGIN, and SESSION_COOKIE_SAMESITE. The frontend requires VITE_API_BASE_URL. These values should be stored in protected environment files or deployment secrets, not committed into source control. Database credentials should be limited to the application database and should not use a superuser account for normal operation."));
doc.push(p("A practical internal deployment may place the frontend and backend on the same Ubuntu server, with PostgreSQL either on the same host or a separate internal database server. Same-host deployment is simpler and acceptable for a small office, but separate database hosting improves isolation and backup management. Network rules should allow the frontend users to reach the web/API service and allow only the application server to reach PostgreSQL."));
doc.push(p("Backup strategy should include both logical and physical thinking. Logical backups through pg_dump are easy to restore selectively and are suitable for daily backups at this scale. For stronger recovery point objectives, WAL archiving or managed continuous backups can be introduced. Backup files should be encrypted or stored in restricted locations because they contain user accounts, file metadata, procurement values, messages, and operational history."));
doc.push(p("Monitoring should begin with simple health checks and grow with usage. The /api/health endpoint already verifies database connectivity. A deployment can poll this endpoint and alert when it fails. Additional monitoring should track CPU, memory, disk usage, PostgreSQL connection count, slow queries, failed logins, HTTP 5xx errors, backup success, and available storage. These measurements are more useful than premature architectural complexity."));
doc.push(p("Release management should treat database migrations carefully. Since the schema evolves through numbered SQL files, deployment should apply migrations in order and keep a record of which migrations have run. Before applying migrations to a live office database, a backup should be taken and a rollback plan should be documented. This is especially important for migrations that drop columns, alter constraints, or move data between normalized tables."));

doc.push(chapter(19, "TESTING STRATEGY"));
doc.push(p("No formal automated test suite was discovered in package scripts; the available scripts are build, lint, dev, preview, backend build, backend start, backend dev, and backend typecheck. Therefore the report treats testing as a recommended and partially manual strategy rather than claiming implemented automated coverage. The most important test areas are authentication, role scopes, file lifecycle, search correctness, archive/restore, report totals, division merge/split transfer, and cache invalidation after mutations."));
doc.push(table([["Test Case ID", "Feature", "Expected Result", "Actual Result", "Status"], ["TC-01", "Staff login", "Valid active user receives session and app loads", "To be verified in UAT", "Planned"], ["TC-02", "Viewer login", "Division viewer can access scoped records", "To be verified in UAT", "Planned"], ["TC-03", "File create", "File and child rows persist transactionally", "Implemented path exists", "Code verified"], ["TC-04", "Search pagination", "Results respect filters and page size", "Implemented path exists", "Code verified"], ["TC-05", "Archive restore", "Admin can restore archived file", "Implemented path exists", "Code verified"], ["TC-06", "Report summary", "Permission-scoped summary returned", "Implemented path exists", "Code verified"], ["TC-07", "Unauthorized division access", "403 returned", "Implemented checks exist", "Code verified"]]));

doc.push(chapter(20, "PERFORMANCE OPTIMIZATION"));
doc.push(p("Performance optimizations visible in the code include connection pooling, pagination, indexed SQL filters, SQL-backed search, cache TTLs, export row limits, scoped dashboard/report cache keys, and selective cache invalidation. The design avoids loading all files for most searches; instead, it builds SQL with count and limited result queries. Legacy in-memory filtering remains only as a comparison path behind an environment variable for specific dashboard filters."));
doc.push(p("The schema's pg_trgm indexes support text search patterns where LIKE matching is required. Partial indexes reduce index size for active files and non-null date/value scenarios. Expression indexes support normalized mode and lower-case text filters. These decisions are aligned with the observed query patterns in files.ts, dashboard.ts, reports.ts, and indentors.ts."));

doc.push(chapter(21, "CHALLENGES FACED"));
["Designing a permission model that supports admins, sub-admins, editors, division users, and viewers while preserving division scope.", "Moving search from broad client-side filtering toward parameterized SQL while maintaining compatibility with dashboard filters.", "Modeling a wide file lifecycle without making repeating groups unmanageable; solved through child tables for firms, supply orders, remarks, milestones, and year activity.", "Keeping dashboard and report screens responsive; solved through 30-second and 60-second summary caches.", "Handling destructive operations safely; solved through archival, restore, admin-only permanent delete, and deletion password checks.", "Supporting financial-year operations, division allocation, division merge, and split-transfer workflows.", "Implementing Quick Entry around unique-code lookup while maintaining authorization scope."].forEach((item) => doc.push(bullet(item)));

doc.push(chapter(22, "FUTURE ENHANCEMENTS"));
plannedFeatures.forEach((item) => doc.push(bullet(item)));
doc.push(p("These features are intentionally listed as future enhancements because they were not verified as implemented in the codebase. In particular, Redis, cloud deployment automation, document attachments, mobile-native scanning, and full audit logging should not be described as completed functionality."));

doc.push(chapter(23, "CONCLUSION"));
doc.push(p("File History is a substantial full-stack software engineering project that solves a real office file-indexing problem through a practical architecture. The verified codebase implements authenticated access, division-scoped authorization, file lifecycle management, normalized PostgreSQL storage, advanced SQL-backed search, dashboard and report summaries, caching, unique-code quick entry, archival workflows, messaging, settings, division management, user management, and deployment-aware configuration."));
doc.push(p("The project demonstrates important engineering lessons: relational modeling matters for long-term maintainability, authorization must be enforced on the backend, search performance requires both query design and indexes, dashboards benefit from scoped caching, and internal office systems need backup, archive, and restore workflows as much as visual polish. With future enhancements such as audit logs, Redis, mobile scanning, document attachments, and cloud-ready deployment, the system can evolve into a more comprehensive records management platform."));

doc.push(p("REFERENCES", "Heading1", { pageBreakBefore: true }));
["React Documentation", "TypeScript Documentation", "Express.js Documentation", "PostgreSQL Documentation", "node-postgres pg Documentation", "TanStack Router Documentation", "Software Engineering: A Practitioner's Approach", "Database System Concepts", "OWASP Web Application Security Guidance"].forEach((item) => doc.push(bullet(item)));

doc.push(p("APPENDIX A - VERIFIED CODEBASE ANALYSIS", "Heading1", { pageBreakBefore: true }));
doc.push(p("Frontend folder structure"));
doc.push(code(frontendStructure));
doc.push(p("Backend folder structure"));
doc.push(code(backendStructure));
doc.push(p("API inventory"));
doc.push(table([["Method", "Route", "Purpose"], ...apiRows]));
doc.push(p("Implemented versus planned features"));
doc.push(table([["Implemented Features", "Future Enhancements"], [implementedFeatures.join("\n"), plannedFeatures.join("\n")]]));
doc.push(figurePlaceholder(7, "Archive Page"));
doc.push(figurePlaceholder(8, "User Management Page"));

const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:body>
    ${doc.join("\n")}
    <w:sectPr>
      <w:footerReference w:type="default" r:id="rIdFooter1"/>
      <w:pgSz w:w="12240" w:h="15840"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>
      <w:cols w:space="720"/>
      <w:docGrid w:linePitch="360"/>
    </w:sectPr>
  </w:body>
</w:document>`;

const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/><w:sz w:val="24"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:line="360" w:lineRule="auto" w:after="120"/></w:pPr></w:pPrDefault></w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
  <w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:qFormat/><w:rPr><w:b/><w:sz w:val="48"/></w:rPr><w:pPr><w:jc w:val="center"/><w:spacing w:after="360"/></w:pPr></w:style>
  <w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/><w:qFormat/><w:rPr><w:b/><w:sz w:val="36"/></w:rPr><w:pPr><w:jc w:val="center"/><w:spacing w:after="240"/></w:pPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:outlineLvl w:val="0"/><w:spacing w:before="240" w:after="180"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:outlineLvl w:val="1"/><w:spacing w:before="180" w:after="120"/></w:pPr><w:rPr><w:b/><w:sz w:val="28"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="TOCHeading"><w:name w:val="TOC Heading"/><w:basedOn w:val="Heading1"/><w:qFormat/></w:style>
  <w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:style>
  <w:style w:type="paragraph" w:styleId="Code"><w:name w:val="Code"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:line="240" w:lineRule="auto" w:after="0"/></w:pPr><w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New"/><w:sz w:val="18"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="TableText"><w:name w:val="Table Text"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:line="240" w:lineRule="auto" w:after="0"/></w:pPr><w:rPr><w:sz w:val="20"/></w:rPr></w:style>
  <w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="808080"/><w:left w:val="single" w:sz="4" w:space="0" w:color="808080"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="808080"/><w:right w:val="single" w:sz="4" w:space="0" w:color="808080"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="808080"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="808080"/></w:tblBorders></w:tblPr></w:style>
</w:styles>`;

const numberingXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum>
  <w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
</w:numbering>`;

const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>
  <Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>
  <Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>
</Types>`;

const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
  <Relationship Id="rIdNumbering" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>
  <Relationship Id="rIdSettings" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>
  <Relationship Id="rIdFooter1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>
</Relationships>`;

const settingsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:updateFields w:val="true"/></w:settings>`;

const footerXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t>Page </w:t></w:r><w:fldSimple w:instr="PAGE"><w:r><w:t>1</w:t></w:r></w:fldSimple></w:p></w:ftr>`;

fs.rmSync(tmp, { recursive: true, force: true });
fs.mkdirSync(path.join(tmp, "_rels"), { recursive: true });
fs.mkdirSync(path.join(tmp, "word", "_rels"), { recursive: true });
fs.writeFileSync(path.join(tmp, "[Content_Types].xml"), contentTypes);
fs.writeFileSync(path.join(tmp, "_rels", ".rels"), rels);
fs.writeFileSync(path.join(tmp, "word", "document.xml"), documentXml);
fs.writeFileSync(path.join(tmp, "word", "styles.xml"), stylesXml);
fs.writeFileSync(path.join(tmp, "word", "numbering.xml"), numberingXml);
fs.writeFileSync(path.join(tmp, "word", "settings.xml"), settingsXml);
fs.writeFileSync(path.join(tmp, "word", "footer1.xml"), footerXml);
fs.writeFileSync(path.join(tmp, "word", "_rels", "document.xml.rels"), docRels);
fs.rmSync(outFile, { force: true });
execFileSync("zip", ["-qr", outFile, "[Content_Types].xml", "_rels", "word"], { cwd: tmp });
fs.rmSync(tmp, { recursive: true, force: true });
console.log(outFile);
console.log(analysisFile);
