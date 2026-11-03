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
 * `files` table as `f`. By default, active carry-forward files whose origin
 * year is archived remain visible while inactive archived-origin files stay
 * out of normal views. When the option is turned off, all files from archived
 * origin years are excluded. Explicit historical/all-files scopes bypass this
 * predicate at the caller.
 */
export function getSearchableFinancialYearSql(
  activeFilesSql: string,
  includeActiveArchivedYears = true,
) {
  if (!includeActiveArchivedYears) {
    return `not exists (
    select 1 from financial_years archived_search_year
    where archived_search_year.label = f.year
      and archived_search_year.is_archived = true
  )`;
  }
  return `(not exists (
    select 1 from financial_years archived_search_year
    where archived_search_year.label = f.year
      and archived_search_year.is_archived = true
  ) or ${activeFilesSql})`;
}
