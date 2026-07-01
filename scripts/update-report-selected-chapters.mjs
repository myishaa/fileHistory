import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = process.cwd();
const inputDocx = path.join(root, "File_History_Project_Report.docx");
const outputDocx = path.join(root, "File_History_Project_Report_Updated.docx");
const tmp = path.join(root, ".report-update-tmp");

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

function bullet(text) {
  return `<w:p><w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>${r(text)}</w:p>`;
}

function code(text) {
  return String(text)
    .split("\n")
    .map((line) => `<w:p><w:pPr><w:pStyle w:val="Code"/></w:pPr>${r(line, { font: "Courier New", size: 9 })}</w:p>`)
    .join("");
}

function table(rows) {
  const grid = rows[0]?.map(() => '<w:gridCol w:w="2400"/>').join("") ?? "";
  return `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/><w:tblLook w:firstRow="1" w:noHBand="0" w:noVBand="1"/></w:tblPr><w:tblGrid>${grid}</w:tblGrid>${rows
    .map((row, rowIndex) => `<w:tr>${row
      .map((cell) => `<w:tc><w:tcPr><w:tcW w:w="2400" w:type="dxa"/>${rowIndex === 0 ? '<w:shd w:fill="D9EAF7"/>' : ""}</w:tcPr>${p(cell, "TableText", { bold: rowIndex === 0 })}</w:tc>`)
      .join("")}</w:tr>`)
    .join("")}</w:tbl>`;
}

function chapter(num, title) {
  return p(`CHAPTER ${num} - ${title}`, "Heading1", { pageBreakBefore: true });
}

function h2(title) {
  return p(title, "Heading2", { bold: true });
}

function replaceChapter(xml, currentHeading, nextHeading, replacement) {
  const start = xml.indexOf(`<w:t xml:space="preserve">${esc(currentHeading)}</w:t>`);
  if (start < 0) throw new Error(`Could not find ${currentHeading}`);
  const startPara = xml.lastIndexOf("<w:p>", start);
  const next = xml.indexOf(`<w:t xml:space="preserve">${esc(nextHeading)}</w:t>`, start);
  if (next < 0) throw new Error(`Could not find ${nextHeading}`);
  const nextPara = xml.lastIndexOf("<w:p>", next);
  return xml.slice(0, startPara) + replacement + xml.slice(nextPara);
}

function chapter7() {
  const out = [];
  out.push(chapter(7, "SYSTEM ARCHITECTURE"));
  out.push(p("The File History application follows a layered client-server architecture implemented with a React and TypeScript frontend, an Express.js and TypeScript backend, and a PostgreSQL relational database. This design is visible in the codebase through the separation of src routes and components on the frontend, backend/src route modules on the server, and numbered SQL migrations in the database directory. The architecture is intentionally practical for an internal office system: it avoids unnecessary microservice complexity, keeps deployment simple on a LAN server, and still separates responsibilities clearly enough for maintenance, security, and future scaling."));
  out.push(p("The system is built around the idea that the browser should handle presentation and workflow orchestration, while the backend remains the authority for authentication, authorization, validation, database access, reports, cache invalidation, and export generation. This is an important engineering decision because file records contain division-specific operational information and procurement workflow metadata. If authorization were implemented only in the frontend, a user could bypass the interface and call APIs directly. The backend therefore applies role checks and division checks before accessing data."));
  out.push(code(`High-Level Architecture

Office Users
  |
  | Web browser
  v
React + TypeScript Frontend
  - TanStack Router route modules
  - Tailwind CSS user interface
  - API-backed client store
  - Dashboard, search, add/edit, reports, settings, messages
  |
  | REST calls with credentials included
  v
Express.js TypeScript Backend
  - CORS and JSON middleware
  - attachAuthUser session middleware
  - route modules under /api
  - authorization helpers
  - SQL search, dashboard, reports, exports
  - in-memory TTL cache
  |
  | node-postgres Pool, max 30 connections
  v
PostgreSQL Database
  - normalized relational schema
  - UUID primary keys and foreign keys
  - pgcrypto and pg_trgm extensions
  - B-tree, partial, expression, and GIN indexes`));
  out.push(h2("Architectural Style"));
  out.push(p("The architectural style is a modular monolith with a REST API boundary. It is not a distributed microservice architecture. This is a deliberate and appropriate choice for the expected workload of 500-600 total users, approximately 100 active editors, and 200-300 file modifications per day. A microservice architecture would introduce service discovery, inter-service authentication, distributed tracing, network failure handling, and data ownership problems that are not necessary for the current scale. The current design keeps business logic close to the database while still organizing the code into clear modules."));
  out.push(p("The backend exposes route modules for auth, files, dashboard, reports, divisions, exports, indentors, live status, messages, settings, users, and health. This gives the application a modular source structure without requiring separate deployable services. The frontend mirrors this operational structure through route modules such as add, search, dashboard, reports, settings, messages, quick-entry, divisions, mmg-live, and year-setup. This pairing makes the system easier to reason about: each major user workflow has a corresponding backend capability."));
  out.push(table([["Layer", "Implemented Responsibility", "Engineering Rationale"], ["Frontend", "Routes, forms, filters, tables, login screen, quick entry, dashboard views", "Keeps interaction logic close to the user and avoids server-side page rendering complexity"], ["API layer", "Authentication, authorization, validation, cache control, SQL query orchestration", "Centralizes sensitive rules and prevents client-side bypass"], ["Database", "Persistent records, relationships, indexes, constraints, password hash verification support", "Provides consistency, query capability, and long-term retention"], ["Deployment layer", "Nginx/static frontend, Node backend, PostgreSQL, systemd, backups", "Matches internal LAN deployment with manageable operations"]]));
  out.push(h2("Frontend Component and Route Responsibilities"));
  out.push(p("The frontend is a Vite/TanStack Router React application. The root route creates the application shell, provides the QueryClient, applies theme settings, displays the TopBar for authenticated users, and shows the login screen when no user is loaded. The code uses VITE_API_BASE_URL to target the backend and includes credentials on API calls so the HTTP-only session cookie can be sent. The public /mmg-live route is deliberately allowed outside the normal authenticated shell, which matches the live-display behavior implemented by the backend /api/live/mmg endpoint."));
  out.push(p("The add route implements the file creation and editing workflow. It is responsible for large operational forms, section navigation, milestone handling, firm details, supply-order child rows, remarks, timelines, and report export helpers. The search route implements advanced filtering, table presets, backend search requests, pagination, inline edits, printing, and exports. The dashboard and reports routes request summary endpoints rather than calculating every aggregate locally. This is an important performance decision: the backend and database are better suited for large aggregations and permission-scoped data filtering than a browser that may not have all records loaded."));
  out.push(p("The frontend store in files-store.ts centralizes API calls for login, viewer login, logout, files, messages, divisions, settings, users, archives, indentors, and unique-code lookup. This store is not a full enterprise state-management framework, but it is sufficient for the current internal application. It gives route components a shared way to load authenticated context and mutate data while preserving a straightforward code path."));
  out.push(h2("Backend Request Lifecycle"));
  out.push(p("The backend server is created in backend/src/server.ts. It configures CORS, JSON parsing with a 15 MB limit, authentication attachment, route mounting, and centralized error handling. The CORS policy reads FRONTEND_ORIGIN and, in non-production mode, allows localhost and 192.168.x.x LAN origins. This supports both local development and office network testing without hardcoding every development port. In production mode, origins must match the configured list."));
  out.push(code(`Request Lifecycle

1. Browser sends request to /api/* with credentials.
2. Express CORS middleware validates the origin and allows credentials.
3. express.json parses the request body up to 15 MB.
4. attachAuthUser reads recordkeeper_session if present.
5. The session token is SHA-256 hashed and looked up in auth_sessions.
6. The route handler calls requireAuth, requireAdmin, canMutateFiles, or division checks.
7. The handler builds parameterized SQL and uses the shared PostgreSQL pool.
8. For dashboard/report/settings/lookups, the cache may return a recent value.
9. The response is returned as JSON, PDF, or Excel-compatible output.
10. Central error middleware returns a status-coded JSON error for HttpError.`));
  out.push(p("This lifecycle supports maintainability because cross-cutting behavior is not repeated in every route. Authentication attachment happens once. Error handling happens once. Common validation helpers are reused. Authorization helpers are imported where needed. Cache behavior is centralized through prefix-based functions. The route modules still contain domain logic, but they operate within a consistent request framework."));
  out.push(h2("Database Interaction Architecture"));
  out.push(p("The backend uses node-postgres directly through a Pool configured with max 30, connectionTimeoutMillis 5000, and idleTimeoutMillis 30000. Direct SQL is used instead of an ORM. This is a trade-off: it requires more manual query writing, but it gives precise control over the complex domain filters in this project. The files route composes SQL for milestone filters, dashboard filters, supply-order existence checks, value ranges, cancellation status, free-text search, date search, and sorting. The dashboard and reports routes similarly rely on SQL summaries that are easier to optimize when written explicitly."));
  out.push(p("Transactions are used where multi-table consistency matters. File creation inserts the files row and then replaces nested firms, supply orders, remarks, completed milestones, and active years within a transaction. File updates similarly use transactional replacement for nested data. Division merge and split-transfer operations use transactions because they update allocations, division history, file division assignments, and active-year records. This design protects consistency when an operation spans multiple tables."));
  out.push(h2("Caching and Read Optimization"));
  out.push(p("The system implements an in-memory TTL cache using a Map. This cache is used for auth session loading, settings, divisions, lookup values, dashboard summaries, and report summaries. Dashboard summaries are cached for 30 seconds and report summaries for 60 seconds. Cache keys include permission scope through getAuthScopeCacheKey, which prevents a restricted user's summary from being reused for an admin or another division."));
  out.push(p("The cache is intentionally simple. It does not claim distributed cache behavior. For a single internal application server, this design reduces repeated expensive summary queries without adding Redis operations, deployment steps, or failure modes. Mutation paths clear relevant prefixes, such as dashboard:summary and reports:summary after file changes, and settings/division lookup prefixes after configuration changes. This is a good fit for the expected workload because edits are moderate while dashboard and report reads may be frequent."));
  out.push(h2("Scalability for Expected Workload"));
  out.push(p("For 500-600 registered users and approximately 100 active editors, the system's main scalability support comes from server-side pagination, database indexes, connection pooling, SQL-backed search, and short-lived cache windows. Most users will not be editing at the same instant. The expected 200-300 modifications per day is well within the capability of a PostgreSQL-backed internal application, especially because writes are transactional but not continuous high-volume streaming writes."));
  out.push(p("The pool size of 30 means the application can serve concurrent database-backed requests without opening one PostgreSQL connection per user. Requests that do not currently hold a database connection can wait for a pool slot. For an internal office deployment, this is a reasonable starting point. If monitoring later shows pool saturation, the response should not automatically be to raise the pool limit; the team should first identify slow queries, long report requests, missing indexes, and unnecessary repeated calls."));
  out.push(p("The architecture also has a clear scaling path. The frontend can remain statically served. The backend can be replicated behind a load balancer because session state is stored in PostgreSQL rather than process memory. However, before multiple backend instances are used, the in-memory cache should be replaced or supplemented with Redis because local cache invalidation would not propagate between processes. PostgreSQL read replicas can be considered for dashboard and report traffic if analytical reads become heavy."));
  out.push(h2("Maintainability and Trade-Offs"));
  out.push(p("The main maintainability strength is that domain boundaries are visible. The files route owns file lifecycle behavior, the auth utility owns session interpretation, cache utilities own TTL storage and invalidation, settings route owns preferences and global configuration, and database migrations describe schema evolution. The main trade-off is that some route files are large because the domain is large. This is not incorrect, but future refactoring could extract file search builders, file mutation services, and reporting helpers into smaller modules as the project matures."));
  out.push(p("Another trade-off is the use of in-memory cache. It is easy to operate and fast, but it is tied to one running backend process. This is acceptable for the current deployment model and workload. The report therefore treats Redis as a future recommendation, not as implemented functionality. Similarly, the deployment documents describe LAN hosting with Nginx and systemd, but the code itself does not implement container orchestration, cloud autoscaling, or managed monitoring."));
  out.push(code(`Component Interaction Diagram

LoginScreen / App Routes
  -> files-store.ts request helper
    -> Express route module
      -> auth utility for session and scope
      -> route validation helpers
      -> PostgreSQL pool
      -> cache utility when applicable
    <- JSON result or exported file
  <- local state/store update
React route re-renders visible workflow`));
  return out.join("\n");
}

function chapter17() {
  const out = [];
  out.push(chapter(17, "SECURITY CONSIDERATIONS"));
  out.push(p("Security in File History is implemented primarily at the backend and database layers. The frontend provides the login interface and hides or exposes workflows based on the loaded user, but the security boundary is not the browser. The Express backend verifies sessions, checks roles, applies division scopes, validates request bodies, constructs parameterized SQL queries, and returns controlled error responses. This is the correct design for an office records system because users may have different department-level access and because direct API calls must not bypass application rules."));
  out.push(h2("Authentication Model"));
  out.push(p("The implemented authentication mechanism is a server-side session design using an HTTP-only cookie named recordkeeper_session. During login, the backend validates the submitted password against the stored password_hash using PostgreSQL crypt. If validation succeeds, the backend generates a random 32-byte base64url token, hashes it with SHA-256, stores only the hash in auth_sessions, and sends the raw token to the browser in the HTTP-only cookie. Sessions expire after seven days."));
  out.push(p("This design has several advantages. Because the cookie is HTTP-only, application JavaScript cannot read the session token directly. Because the database stores a token hash rather than the token itself, database exposure would not immediately reveal active cookie values. Because sessions are stored in PostgreSQL rather than only memory, the backend can restart without logging out all users, and horizontal scaling remains possible in the future. The design also allows logout to delete the current session row."));
  out.push(code(`Implemented Session Flow

Staff login:
  username + password
    -> POST /api/auth/login
    -> app_users lookup and crypt(password, password_hash)
    -> random session token generated
    -> SHA-256 token hash stored in auth_sessions
    -> HTTP-only recordkeeper_session cookie set

Authenticated request:
  cookie sent by browser
    -> token hash calculated
    -> auth_sessions row loaded if not expired
    -> app user and user_divisions loaded
    -> request.authUser attached`));
  out.push(p("The code also implements division viewer login. A viewer selects a division and enters that division's viewer password. The backend validates divisions.viewer_password_hash with crypt and creates an auth_sessions row using viewer_division_id instead of user_id. The resulting auth user has role viewer and a single division scope. This is a useful design for controlled read/query access because it avoids creating full staff accounts for every viewing use case."));
  out.push(h2("Authorization and Least Privilege"));
  out.push(p("Authorization is centralized in backend/src/utils/auth.ts. requireAuth enforces login, requireAdmin limits admin-only operations, canUseAllDivisions returns true for admin and sub_admin, canMutateFiles allows admin, sub_admin, and editor to mutate files, canAccessDivision checks whether a user may access a division, and getDivisionScopeCondition returns SQL predicates for scoped queries. This architecture follows the principle of least privilege because route handlers must explicitly ask for the required permission before continuing."));
  out.push(table([["Control", "Implemented Mechanism", "Security Purpose"], ["Login required", "requireAuth", "Blocks anonymous use of protected APIs"], ["Admin-only actions", "requireAdmin", "Protects users, settings, archives, and division administration"], ["File mutation", "canMutateFiles", "Limits add/edit/delete to admin, sub_admin, editor"], ["Division boundary", "canAccessDivision and getDivisionScopeCondition", "Prevents cross-division data exposure"], ["Viewer access", "viewer_division_id sessions", "Allows limited division-specific access"], ["Cache isolation", "getAuthScopeCacheKey", "Prevents summary cache reuse across permission scopes"]]));
  out.push(p("Division scoping is one of the most important security decisions. For list and summary endpoints, it is not enough to load all records and hide unauthorized rows in the frontend. The backend converts the user's division scope into SQL conditions, usually against the file or message division_id. If a restricted user has no allowed divisions, getDivisionScopeCondition returns 1 = 0, which intentionally produces no rows. This is a strong defensive pattern because the database query itself is scoped."));
  out.push(h2("Password and Cookie Security"));
  out.push(p("User passwords and division viewer passwords are not stored as plain text. The code uses PostgreSQL pgcrypto functions crypt and gen_salt('bf') when creating or updating user passwords and viewer passwords. Login verification uses crypt with the stored hash. The report should not claim a custom password hashing service or external identity provider because none is visible in the codebase. The implemented design is database-backed password hashing through PostgreSQL."));
  out.push(p("Cookie options are derived from NODE_ENV and SESSION_COOKIE_SAMESITE. The cookie is always HTTP-only. SameSite defaults to lax unless the environment explicitly provides none, strict, or lax. The secure flag is true when NODE_ENV is production or SameSite is none. This is a practical implementation for both same-site LAN deployment and future HTTPS cross-site deployment. In the documented LAN deployment, FRONTEND_ORIGIN and VITE_API_BASE_URL are configured for the server address, and Nginx proxies API traffic."));
  out.push(h2("Input Validation and SQL Injection Prevention"));
  out.push(p("The backend uses helper validation functions such as requireObjectBody, requireString, and requireParam. Several route modules also define specialized readers for booleans, arrays, positive integers, roles, themes, financial years, dates, export columns, threshold levels, and search parameters. This reduces accidental processing of malformed requests. The validation is not presented as a full schema-validation framework for every route, but it is consistently used in important workflows."));
  out.push(p("SQL injection prevention is primarily achieved through parameterized queries. Values are passed separately from SQL text through node-postgres placeholders. The advanced search builder adds values to an array and inserts numbered placeholders such as $1, $2, and so on. Dynamic behavior such as sort columns and search fields is constrained through mappings from known frontend keys to fixed SQL expressions. This prevents a user from supplying arbitrary SQL column names or raw SQL fragments for normal filters."));
  out.push(code(`Search Security Pattern

User filter value
  -> read and normalize query parameter
  -> addSqlValue(values, normalizedValue)
  -> SQL receives numbered placeholder
  -> pg sends value separately to PostgreSQL

User-selected field or sort key
  -> checked against known TypeScript mapping
  -> mapped to fixed SQL column/expression
  -> unknown keys ignored or rejected`));
  out.push(h2("Data Protection and Destructive Operations"));
  out.push(p("The application implements soft archival for files and divisions. For file deletion, non-admin users who can mutate files do not permanently delete the database row. Instead, the backend sets archived_at, archived_by, and archive_reason. Admin users can permanently delete files, but permanent deletion requires the configured deletion password from app_settings. Archived files can be listed and restored by admins. Division deletion similarly archives the division first, with separate archive list, restore, and permanent delete routes."));
  out.push(p("This archival-first design reduces accidental data loss. It also matches real office requirements: file records may be closed, cancelled, or no longer active, but their historical metadata remains valuable for future reference. Permanent deletion is still available for administrative cleanup, but it is intentionally more restricted. The code also protects against deleting or demoting the last active admin account, which prevents the system from being locked without an administrator."));
  out.push(h2("Message Workflow Security"));
  out.push(p("The message workflow is also scoped. Viewers and division users can create short file queries only for accessible files and only when messages are enabled for the file's division. Editors and admins can reply and resolve messages if they can access the associated division. Message deletion is implemented as a soft delete through deleted_at. Message text is limited to 20 words for creation and replies, which constrains the message workflow to short operational queries rather than unrestricted document storage."));
  out.push(h2("Caching and Security Boundaries"));
  out.push(p("Caching can create security risks if data is cached without considering permission scope. The code avoids this for dashboard and report summaries by including getAuthScopeCacheKey in cache keys. Admin and sub-admin users use the all scope, while restricted users use a sorted list of their division IDs or none. Auth session cache entries are keyed by token hash and expire after 30 seconds. User and division changes clear auth or division cache prefixes so permission changes do not remain indefinitely stale."));
  out.push(p("The cache remains in process memory and is therefore not shared across multiple backend instances. This is not a current security flaw in a single-server deployment, but if horizontal scaling is introduced, distributed cache invalidation must be designed carefully. Redis or another shared cache should preserve the same permission-scoped key strategy."));
  out.push(h2("Security Diagram"));
  out.push(code(`Security Architecture

Browser
  |
  | HTTP-only recordkeeper_session cookie
  v
Express Middleware
  - CORS with configured origins
  - JSON body limit
  - attachAuthUser
  |
  v
Session Validation
  - SHA-256 token hash
  - auth_sessions expiry check
  - active app_users check
  - viewer division session support
  |
  v
Authorization Helpers
  - requireAuth
  - requireAdmin
  - canMutateFiles
  - canAccessDivision
  - getDivisionScopeCondition
  |
  v
Parameterized SQL + PostgreSQL Constraints
  - foreign keys
  - role checks
  - archived rows excluded from active queries
  - indexed scoped lookups`));
  out.push(h2("Known Limitations and Future Hardening"));
  out.push(p("The codebase does not show CSRF tokens, login rate limiting, account lockout, centralized audit logs, external identity provider integration, or automated security tests. SameSite cookies and internal LAN deployment reduce some risk, but they do not replace production hardening. The report should therefore treat these as future recommendations rather than implemented features."));
  ["Add audit logging for login, file mutation, archive, restore, settings, user, and division actions.", "Add rate limiting or login throttling to reduce password guessing risk.", "Review CSRF exposure if the frontend and backend are ever deployed on different sites.", "Use HTTPS for production deployments, especially if SameSite none is required.", "Rotate default seeded credentials immediately after first deployment.", "Store database credentials and environment files with restricted operating-system permissions.", "Add automated tests for role boundaries and division-scope enforcement."].forEach((item) => out.push(bullet(item)));
  return out.join("\n");
}

function chapter18() {
  const out = [];
  out.push(chapter(18, "DEPLOYMENT ARCHITECTURE"));
  out.push(p("The deployment model visible in the repository is an internal LAN deployment. The project includes an Ubuntu LAN deployment guide and a backup and recovery guide. The deployment approach builds the React frontend into static files, builds the TypeScript backend into backend/dist, runs the backend with Node.js under systemd, serves the frontend through Nginx, proxies /api traffic to the backend, and stores persistent data in PostgreSQL. This is consistent with the system's target environment: an office network with multiple departments, moderate concurrent usage, and controlled administrative access."));
  out.push(h2("Implemented Deployment Components"));
  out.push(p("The frontend build is produced by npm run build in the repository root. The deployment guide identifies dist/client as the frontend build output. The backend is built by running npm run build inside backend, producing backend/dist. Production backend dependencies are retained through npm install --omit=dev. The database migrations are the numbered SQL files in the database directory. This separation allows the release folder to contain static frontend assets, compiled backend JavaScript, backend node_modules, package metadata, database migrations, and an environment example."));
  out.push(code(`Implemented LAN Deployment Topology

Office Browser
  |
  | http://<server-lan-ip>
  v
Nginx on Ubuntu Server
  - serves /var/www/recordkeeper static frontend
  - proxies /api/* to 127.0.0.1:3000
  |
  v
Node.js Express Backend under systemd
  - WorkingDirectory /opt/recordkeeper/backend
  - ExecStart /usr/bin/node dist/server.js
  - Restart=always
  |
  v
PostgreSQL Database
  - recordkeeper database
  - migrations from database/*.sql
  - pgcrypto and pg_trgm extensions
  |
  v
Backup Folder
  - /opt/recordkeeper/backups
  - daily pg_dump .sql.gz files
  - backup logs and retention policy`));
  out.push(h2("Network Architecture"));
  out.push(p("The documented network model exposes the application through port 80 on the Ubuntu server. Nginx serves the frontend and forwards API requests to the backend on localhost:3000. The guide explicitly notes that port 3000 usually does not need to be exposed because Nginx communicates with the backend locally. This is a useful deployment decision: users interact with one server address, while the backend process is not directly exposed to the LAN."));
  out.push(p("The backend itself listens on 0.0.0.0, but the Nginx configuration proxies to 127.0.0.1:3000. In a hardened deployment, firewall rules should allow HTTP or HTTPS to Nginx and restrict direct access to the backend port. If PostgreSQL runs on the same host, it should not be exposed to general LAN clients. If PostgreSQL runs on a separate internal database server, network rules should allow access only from the application server."));
  out.push(code(`Network Flow

Client PC on LAN
  -> http://server-ip/
     Nginx serves React assets

Client PC on LAN
  -> http://server-ip/api/files/search
     Nginx proxies to http://127.0.0.1:3000/api/files/search
     Express validates session and permissions
     Express queries PostgreSQL
     JSON response returns through Nginx

PostgreSQL
  -> not directly used by browsers
  -> accessed by backend through DATABASE_URL`));
  out.push(h2("Environment Configuration"));
  out.push(p("Configuration is environment-driven. The backend requires DATABASE_URL and can read PORT, FRONTEND_ORIGIN, NODE_ENV, and SESSION_COOKIE_SAMESITE. The frontend uses VITE_API_BASE_URL, and the deployment guide emphasizes that this value is baked into the frontend at build time. If the server IP changes, the frontend must be rebuilt with the new API base URL. This is an important operational trade-off of static frontend builds: they are simple to serve, but runtime API URL changes are not automatic unless a runtime configuration layer is added."));
  out.push(table([["Setting", "Implemented Use", "Deployment Consideration"], ["DATABASE_URL", "PostgreSQL connection string required by backend pool", "Protect credentials and restrict file permissions"], ["PORT", "Backend port, default 3000", "Usually proxied locally by Nginx"], ["FRONTEND_ORIGIN", "Allowed CORS origins", "Must match deployed frontend origin"], ["NODE_ENV", "Controls production behavior such as cookie secure flag and CORS strictness", "Set to production on server"], ["SESSION_COOKIE_SAMESITE", "Cookie SameSite policy, default lax", "Use none only with HTTPS and cross-site need"], ["VITE_API_BASE_URL", "Frontend API target baked at build", "Rebuild frontend when server address changes"]]));
  out.push(h2("Application Server Design"));
  out.push(p("The backend deployment uses systemd with Restart=always and RestartSec=5. This gives basic process supervision: if the Node.js process crashes, systemd restarts it. This is sufficient for an initial internal deployment and easier to operate than a container orchestration platform. The backend health endpoint /api/health checks database connectivity by running select 1 as ok, now() as now. This endpoint can be used manually with curl or by a monitoring tool."));
  out.push(p("Nginx handles static file serving and API proxying. The frontend location uses try_files to return index.html for client-side routes, which is required because TanStack Router routes such as /search, /reports, and /settings are handled in the browser. The /api/ location proxies to the backend and passes Host and X-Real-IP headers. This allows the backend /api/health/ip endpoint to report a client IP using forwarded headers when present."));
  out.push(h2("Database Deployment"));
  out.push(p("The database deployment uses PostgreSQL with postgresql-contrib installed, which is necessary because the migrations use extensions such as pgcrypto and pg_trgm. The initial database is named recordkeeper in the guide. Migrations are applied by iterating through database/*.sql in order. This matches the repository's numbered migration files and supports incremental schema evolution."));
  out.push(p("The database is the most important persistent component in the architecture. The frontend and backend build artifacts can be regenerated from source, but file records, users, divisions, messages, settings, and historical metadata live in PostgreSQL. Therefore database backup, restore testing, and access restriction are central deployment concerns. The application should not be considered production-ready until backups are automated and at least one restore test has been performed."));
  out.push(h2("Backup and Recovery Architecture"));
  out.push(p("The repository includes a backup and recovery guide based on pg_dump. The recommended setup creates daily backups in /opt/recordkeeper/backups, compresses them with gzip, keeps roughly the latest seven daily backups, and writes backup logs. The backup folder is protected with chmod 700 because database dumps may contain sensitive office data. The guide also recommends copying backups to another machine or external drive and periodically testing restores into a separate test database."));
  out.push(code(`Backup Workflow

cron schedule
  -> /opt/recordkeeper/backup-recordkeeper.sh
  -> pg_dump DATABASE_URL
  -> write recordkeeper_<date>.sql
  -> gzip backup file
  -> delete backups older than retention window
  -> append success/failure information to logs

Recovery Workflow
  -> stop recordkeeper-backend
  -> dump damaged database for investigation
  -> select latest good backup
  -> drop and recreate recordkeeper database
  -> restore backup with psql
  -> start backend
  -> verify login, search, dashboard, reports, add/edit`));
  out.push(p("This backup model is appropriate for the expected workload because modifications are moderate. However, it has a recovery point objective equal to the backup frequency. If backups run once per day, legitimate work after the last backup can be lost during restore. For busier offices, the guide recommends two backups per day. A future deployment could improve this further with WAL archiving, managed PostgreSQL continuous backups, or point-in-time recovery."));
  out.push(h2("Reliability and Operations"));
  out.push(p("The implemented reliability features are basic but practical: systemd restarts the backend, Nginx serves static assets and proxies API traffic, /api/health verifies database connectivity, and the backup guide defines daily database backups and recovery steps. The codebase does not implement centralized logging, metrics dashboards, alerting, container health probes, or blue-green deployment. These should be described as future operational recommendations, not current functionality."));
  out.push(p("For 500-600 users and about 100 active editors, this deployment can be adequate if the server has enough CPU, memory, and disk throughput for PostgreSQL and Node.js. The application workload is mostly request/response and database-backed. The backend pool max of 30 prevents uncontrolled database connection growth. Nginx efficiently serves static assets, reducing load on Node.js. Dashboard and report caches reduce repeated aggregate queries. Pagination and export caps help avoid unbounded response sizes."));
  out.push(p("Operational monitoring should initially focus on the components most likely to fail: disk usage, PostgreSQL availability, backup success, backend process status, Nginx status, database connection count, slow queries, and HTTP 5xx errors. The health endpoint can confirm that the backend can reach PostgreSQL, but it does not replace full monitoring. A major-project report should therefore distinguish the implemented health endpoint from recommended monitoring practices."));
  out.push(h2("Deployment Trade-Offs"));
  out.push(table([["Decision", "Benefit", "Trade-Off"], ["LAN server deployment", "Simple, low cost, data remains internal", "Limited high availability unless extra servers are added"], ["Nginx static frontend", "Fast static serving and clean /api proxy", "Frontend API URL is baked at build time"], ["systemd backend", "Simple restart and service management", "No built-in horizontal scaling"], ["PostgreSQL primary database", "Strong consistency and relational querying", "Requires backup and maintenance discipline"], ["In-memory cache", "No Redis dependency and very low latency", "Not shared across multiple backend processes"], ["Daily pg_dump backups", "Easy to understand and restore", "Recovery point depends on backup frequency"]]));
  out.push(h2("Future Deployment Recommendations"));
  out.push(p("Future enhancements should be introduced when operational needs justify them. HTTPS should be added for production, especially if users access the system across networks or if SameSite none cookies are required. Redis should be considered before running multiple backend instances. A reverse proxy can add TLS termination, compression, and stronger headers. PostgreSQL read replicas can offload report reads. A managed database can improve backup and recovery. CI/CD can reduce manual release errors. None of these are visible as implemented features in the current codebase, so they are recommendations."));
  out.push(code(`Future Hardened Deployment

LAN / VPN Users
  -> HTTPS reverse proxy
  -> static frontend + /api proxy
  -> load-balanced Express instances
  -> Redis for shared cache and invalidation
  -> PostgreSQL primary for writes
  -> PostgreSQL read replica for reports
  -> scheduled backups + restore tests + monitoring alerts`));
  return out.join("\n");
}

if (!fs.existsSync(inputDocx)) {
  throw new Error(`Missing input document: ${inputDocx}`);
}

fs.rmSync(tmp, { recursive: true, force: true });
fs.mkdirSync(tmp, { recursive: true });
execFileSync("unzip", ["-q", inputDocx, "-d", tmp]);

const documentPath = path.join(tmp, "word", "document.xml");
let xml = fs.readFileSync(documentPath, "utf8");
xml = replaceChapter(xml, "CHAPTER 7 - SYSTEM ARCHITECTURE", "CHAPTER 8 - DATABASE DESIGN", chapter7());
xml = replaceChapter(xml, "CHAPTER 17 - SECURITY CONSIDERATIONS", "CHAPTER 18 - DEPLOYMENT ARCHITECTURE", chapter17());
xml = replaceChapter(xml, "CHAPTER 18 - DEPLOYMENT ARCHITECTURE", "CHAPTER 19 - TESTING STRATEGY", chapter18());
fs.writeFileSync(documentPath, xml);

fs.rmSync(outputDocx, { force: true });
execFileSync("zip", ["-qr", outputDocx, "[Content_Types].xml", "_rels", "word"], { cwd: tmp });
fs.rmSync(tmp, { recursive: true, force: true });

console.log(outputDocx);
