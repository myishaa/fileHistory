import { pool } from "../db/pool.js";

let schemaReady: Promise<void> | undefined;

/** Ensures older deployments can use FY archiving before migration 090 is applied. */
export function ensureFinancialYearArchiveSchema() {
  schemaReady ??= pool
    .query(
      `alter table financial_years
         add column if not exists is_archived boolean not null default false;
       alter table financial_years
         add column if not exists archived_at timestamptz;
       alter table financial_years
         add column if not exists archived_by uuid references app_users(id) on delete set null;
       create index if not exists financial_years_archived_label_idx
         on financial_years (is_archived, label);`,
    )
    .then(() => undefined);
  return schemaReady;
}

/**
 * Returns the normal searchable-file predicate for a query that uses the
 * `files` table as `f`. Archived origin-year files remain visible when they
 * are still active carry-forward records. Historical views can bypass the
 * predicate explicitly with `includeArchivedYears`.
 */
export function getSearchableFinancialYearSql(
  activeFilesSql: string,
  includeArchivedYears = false,
) {
  if (includeArchivedYears) return undefined;
  return `(not exists (
    select 1 from financial_years archived_search_year
    where archived_search_year.label = f.year
      and archived_search_year.is_archived = true
  ) or ${activeFilesSql})`;
}
