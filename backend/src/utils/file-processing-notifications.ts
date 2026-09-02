import type { PoolClient } from "pg";
import { pool } from "../db/pool.js";
import type { AuthUser, FileRecord, SupplyOrderDetail, StageDeliveryDetail } from "../types.js";
import { canUseAllDivisions } from "./auth.js";

export type FileProcessingChange = {
  field: string;
  label: string;
  oldValue?: string;
  newValue?: string;
  action: "entered" | "cleared" | "changed";
};

type NotificationRow = {
  id: string;
  file_id: string;
  division_id: string | null;
  division_name: string | null;
  unique_code: string | null;
  file_no: string | null;
  imms: string | null;
  changed_by_name: string;
  changed_by_role: string;
  changes: unknown;
  summary: string;
  status: "pending" | "acknowledged";
  acknowledged_by_name: string | null;
  acknowledged_at: Date | string | null;
  created_at: Date | string;
};
type QueryExecutor = Pick<PoolClient, "query">;

let schemaReady: Promise<void> | undefined;

const fileProcessingFields = [
  ["receivedDate", "Demand received date"],
  ["scrutinyDate", "Scrutiny date"],
  ["scrutinyResponseDate", "Scrutiny response date"],
  ["scrutinyCompletionDate", "Scrutiny completion date"],
  ["highValueMeetingDate", "High Value meeting date"],
  ["highValueMinutesDate", "High Value minutes date"],
  ["adSentDate", "AD sent date"],
  ["adVettingDate", "AD vetting date"],
  ["rqaSentDate", "RQA sent date"],
  ["rqaApprovalDate", "RQA approval date"],
  ["ifaSentDate", "IFA sent date"],
  ["ifaFinalDate", "IFA final date"],
  ["cfaSentDate", "CFA sent date"],
  ["cfaDate", "CFA approval date"],
  ["gemUndertakingDate", "GeM undertaking date"],
  ["rfpVettingInitiationDate", "RFP vetting initiation date"],
  ["rfpVettingApprovalDate", "RFP vetting approval date"],
  ["preBidMeetingDate", "Pre-Bid Meeting date"],
  ["bidDate", "Bid date"],
  ["bidOpeningDate", "Bid opening date"],
  ["bidOpened", "Bid opened"],
  ["refloatPreBidMeetingDate", "Refloat Pre-Bid Meeting date"],
  ["refloatBiddingDate", "Refloat bid date"],
  ["refloatBidOpeningDate", "Refloat bid opening date"],
  ["biddingStageOver", "Bidding stage over"],
  ["postTcecDate", "Post-TCEC date"],
  ["postTcecMinutesDate", "Post-TCEC minutes date"],
  ["refloatPostTcecDate", "Refloat Post-TCEC date"],
  ["refloatPostTcecMinutesDate", "Refloat Post-TCEC minutes date"],
  ["cncDate", "CNC date"],
  ["cncApprovalDate", "CNC approval date"],
  ["demandCancelled", "Demand cancelled"],
  ["demandCancelledDate", "Demand cancellation date"],
  ["fileClosureDate", "File closure date"],
] as const;

const supplyOrderProcessingFields = [
  ["financialSanctionDate", "Financial Sanction date"],
  ["soNo", "S.O. no."],
  ["gemSoNo", "GeM S.O. no."],
  ["soDate", "S.O. date"],
  ["soValueCapital", "S.O. capital value"],
  ["soValueRevenue", "S.O. revenue value"],
  ["firm", "Firm"],
  ["dpDate", "D.P. date"],
  ["revisedDp", "Revised D.P."],
  ["materialReceiptDate", "Material receipt date"],
  ["jobCompletionDate", "Job Completion date"],
  ["irPreparationDate", "IR Preparation date"],
  ["irReceiptDate", "IR Receipt date"],
  ["billPreparationDate", "Bill preparation date"],
  ["billSentForPaymentDate", "Bill sent for payment date"],
  ["paymentDate", "Payment date"],
  ["paymentMode", "Payment mode"],
  ["actualPaymentCapital", "Actual payment capital"],
  ["actualPaymentRevenue", "Actual payment revenue"],
  ["psbBgReceivedDate", "PSB BG received date"],
  ["psbBgValidityDate", "PSB BG validity date"],
  ["psbBgReturnDate", "PSB BG return date"],
  ["pwbBgReceivedDate", "PWB BG received date"],
  ["pwbBgValidityDate", "PWB BG validity date"],
  ["pwbBgReturnDate", "PWB BG return date"],
  ["combinedBgReceivedDate", "PSB+PWB BG received date"],
  ["combinedBgValidityDate", "PSB+PWB BG validity date"],
  ["combinedBgReturnDate", "PSB+PWB BG return date"],
  ["warrantyPeriodDate", "Warranty period date"],
  ["soCancelled", "S.O. cancelled"],
  ["soCancelledDate", "S.O. cancellation date"],
  ["shortclosure", "Shortclosure"],
  ["shortclosureDate", "Shortclosure date"],
] as const;

const stageProcessingFields = [
  ["dpDate", "D.P. date"],
  ["revisedDp", "Revised D.P."],
  ["materialReceiptDate", "Material receipt date"],
  ["jobCompletionDate", "Job Completion date"],
  ["irPreparationDate", "IR Preparation date"],
  ["irReceiptDate", "IR Receipt date"],
  ["billPreparationDate", "Bill preparation date"],
  ["billSentForPaymentDate", "Bill sent for payment date"],
  ["paymentDate", "Payment date"],
  ["paymentMode", "Payment mode"],
  ["actualPaymentCapital", "Actual payment capital"],
  ["actualPaymentRevenue", "Actual payment revenue"],
] as const;

export async function ensureFileProcessingNotificationSchema() {
  schemaReady ??= (async () => {
    await pool.query(`
      create table if not exists file_processing_notifications (
        id uuid primary key default gen_random_uuid(),
        file_id uuid not null references files(id) on delete cascade,
        division_id uuid references divisions(id) on delete set null,
        changed_by_user_id uuid references app_users(id) on delete set null,
        changed_by_name text not null,
        changed_by_role text not null,
        changes jsonb not null default '[]'::jsonb,
        summary text not null,
        status text not null default 'pending' check (status in ('pending', 'acknowledged')),
        acknowledged_by_user_id uuid references app_users(id) on delete set null,
        acknowledged_by_name text,
        acknowledged_at timestamptz,
        created_at timestamptz not null default now()
      )
    `);
    await pool.query(`
      create index if not exists file_processing_notifications_division_status_idx
      on file_processing_notifications(division_id, status, created_at desc)
    `);
    await pool.query(`
      create index if not exists file_processing_notifications_file_idx
      on file_processing_notifications(file_id, created_at desc)
    `);
  })();
  await schemaReady;
}

export function buildFileProcessingChanges(oldFile: FileRecord, newFile: FileRecord) {
  const changes: FileProcessingChange[] = [];
  compareFields(changes, "", oldFile, newFile, fileProcessingFields);

  const oldOrders = oldFile.supplyOrders ?? [];
  const newOrders = newFile.supplyOrders ?? [];
  const maxOrders = Math.max(oldOrders.length, newOrders.length);
  for (let index = 0; index < maxOrders; index += 1) {
    const oldOrder = oldOrders[index];
    const newOrder = newOrders[index];
    if (!oldOrder && !newOrder) continue;
    const orderLabel = `S.O. ${index + 1}`;
    compareFields(changes, orderLabel, oldOrder, newOrder, supplyOrderProcessingFields);
    const oldStages = oldOrder?.stageDeliveries ?? [];
    const newStages = newOrder?.stageDeliveries ?? [];
    const maxStages = Math.max(oldStages.length, newStages.length);
    for (let stageIndex = 0; stageIndex < maxStages; stageIndex += 1) {
      compareFields(
        changes,
        `${orderLabel} Delivery-${stageIndex + 1}`,
        oldStages[stageIndex],
        newStages[stageIndex],
        stageProcessingFields,
      );
    }
  }
  return changes;
}

export async function createFileProcessingNotification({
  client,
  file,
  user,
  changes,
}: {
  client: QueryExecutor;
  file: FileRecord;
  user: AuthUser;
  changes: FileProcessingChange[];
}) {
  if (!changes.length) return;
  await ensureFileProcessingNotificationSchema();
  const division = await client.query<{ division_id: string | null }>(
    "select division_id from files where id = $1",
    [file.id],
  );
  const divisionId = division.rows[0]?.division_id;
  if (!divisionId) return;
  const summary = changes.map(formatChangeSummary).join("\n");
  await client.query(
    `insert into file_processing_notifications (
       file_id, division_id, changed_by_user_id, changed_by_name, changed_by_role, changes, summary
     )
     values ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
    [file.id, divisionId, user.id, user.name, user.role, JSON.stringify(changes), summary],
  );
}

export async function loadFileProcessingNotifications(user: AuthUser) {
  await ensureFileProcessingNotificationSchema();
  const conditions: string[] = [];
  const values: unknown[] = [];
  if (!canUseAllDivisions(user)) {
    if (!user.divisionIds.length) return [];
    values.push(user.divisionIds);
    conditions.push(`n.division_id = any($${values.length}::uuid[])`);
  }
  const whereSql = conditions.length ? `where ${conditions.join(" and ")}` : "";
  const result = await pool.query<NotificationRow>(
    `select
       n.id, n.file_id, n.division_id, d.name as division_name,
       f.unique_code, f.file_no, f.imms,
       n.changed_by_name, n.changed_by_role, n.changes, n.summary, n.status,
       n.acknowledged_by_name, n.acknowledged_at, n.created_at
     from file_processing_notifications n
     join files f on f.id = n.file_id and f.archived_at is null
     left join divisions d on d.id = n.division_id
     ${whereSql}
     order by
       case when n.status = 'pending' then 0 else 1 end,
       n.created_at desc`,
    values,
  );
  return result.rows.map(mapNotification);
}

export async function acknowledgeFileProcessingNotification(id: string, user: AuthUser) {
  await ensureFileProcessingNotificationSchema();
  const existing = await pool.query<{ division_id: string | null }>(
    "select division_id from file_processing_notifications where id = $1",
    [id],
  );
  if (!existing.rows[0]) return undefined;
  const divisionId = existing.rows[0].division_id;
  if (!canUseAllDivisions(user) && !user.divisionIds.includes(divisionId ?? "")) {
    return undefined;
  }
  await pool.query(
    `update file_processing_notifications
     set status = 'acknowledged',
         acknowledged_by_user_id = $2,
         acknowledged_by_name = $3,
         acknowledged_at = now()
     where id = $1`,
    [id, user.id.startsWith("viewer:") ? null : user.id, user.name],
  );
  const notifications = await loadFileProcessingNotifications(user);
  return notifications.find((notification) => notification.id === id);
}

function compareFields(
  changes: FileProcessingChange[],
  prefix: string,
  oldObject: Record<string, unknown> | undefined,
  newObject: Record<string, unknown> | undefined,
  fields: ReadonlyArray<readonly [string, string]>,
) {
  for (const [field, label] of fields) {
    const oldValue = normalizeChangeValue(oldObject?.[field]);
    const newValue = normalizeChangeValue(newObject?.[field]);
    if (oldValue === newValue) continue;
    const action =
      !oldValue && newValue ? "entered" : oldValue && !newValue ? "cleared" : "changed";
    changes.push({
      field,
      label: prefix ? `${prefix} - ${label}` : label,
      oldValue: oldValue || undefined,
      newValue: newValue || undefined,
      action,
    });
  }
}

function normalizeChangeValue(value: unknown) {
  if (Array.isArray(value) || (value && typeof value === "object")) return JSON.stringify(value);
  return String(value ?? "").trim();
}

function formatChangeSummary(change: FileProcessingChange) {
  if (change.action === "entered") return `${change.label} entered: ${change.newValue}`;
  if (change.action === "cleared") return `${change.label} cleared: ${change.oldValue}`;
  return `${change.label} changed from ${change.oldValue || "blank"} to ${change.newValue || "blank"}`;
}

function mapNotification(row: NotificationRow) {
  return {
    id: row.id,
    fileId: row.file_id,
    divisionId: row.division_id ?? undefined,
    divisionName: row.division_name ?? "Unassigned",
    fileUniqueCode: row.unique_code ?? undefined,
    fileNo: row.file_no ?? undefined,
    imms: row.imms ?? undefined,
    changedByName: row.changed_by_name,
    changedByRole: row.changed_by_role,
    changes: Array.isArray(row.changes) ? (row.changes as FileProcessingChange[]) : [],
    summary: row.summary,
    status: row.status,
    acknowledgedByName: row.acknowledged_by_name ?? undefined,
    acknowledgedAt: toIso(row.acknowledged_at),
    createdAt: toIso(row.created_at) ?? "",
  };
}

function toIso(value: Date | string | null | undefined) {
  if (!value) return undefined;
  return value instanceof Date ? value.toISOString() : String(value);
}
