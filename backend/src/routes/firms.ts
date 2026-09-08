import { Router } from "express";
import { pool } from "../db/pool.js";
import type { AuthUser, MasterFirm } from "../types.js";
import { canMutateFiles, requireAuth, type AuthRequest } from "../utils/auth.js";
import { fromDbText, toDbText } from "../utils/db-values.js";
import { asyncHandler, HttpError, requireObjectBody, requireParam } from "../utils/http.js";

export const firmsRouter = Router();

type MasterFirmRow = {
  id: string;
  firm_name: string | null;
  email_id: string | null;
  city: string | null;
  address: string | null;
  firm_unique_no: string | null;
  contact_no: string | null;
  firm_rating?: string | null;
  created_by: string | null;
  created_by_name: string | null;
  archived_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

function mapFirm(row: MasterFirmRow): MasterFirm {
  return {
    id: row.id,
    firmName: fromDbText(row.firm_name) || undefined,
    emailId: fromDbText(row.email_id) || undefined,
    city: fromDbText(row.city) || undefined,
    address: fromDbText(row.address) || undefined,
    firmUniqueNo: fromDbText(row.firm_unique_no) || undefined,
    contactNo: fromDbText(row.contact_no) || undefined,
    firmRating: fromDbText(row.firm_rating) || undefined,
    createdBy: row.created_by ?? undefined,
    createdByName: row.created_by_name ?? undefined,
    archivedAt: row.archived_at ? new Date(row.archived_at).toISOString() : undefined,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

type FirmRatingField = {
  id: string;
  label: string;
  weight?: string;
};

type FirmRatingConfig = {
  fields: FirmRatingField[];
};

type SupplyOrderRatingRow = {
  firm: string | null;
  firm_unique_no: string | null;
  firm_rating_values: unknown;
};

const defaultFirmRatingConfig: FirmRatingConfig = {
  fields: [
    { id: "delivery", label: "Delivery", weight: "1" },
    { id: "quality", label: "Quality", weight: "1" },
    { id: "afterSalesService", label: "After Sales Service", weight: "1" },
  ],
};

function normalizeFirmRatingConfig(value: unknown): FirmRatingConfig {
  const source =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const fields = Array.isArray(source.fields) ? source.fields : defaultFirmRatingConfig.fields;
  const normalized = fields.reduce<FirmRatingField[]>((result, item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return result;
    const candidate = item as Record<string, unknown>;
    const label = toDbText(candidate.label) || `Rating ${index + 1}`;
    const rawId = toDbText(candidate.id) || label;
    const id =
      rawId
        .replace(/[^a-zA-Z0-9]+(.)/g, (_match, chr: string) => chr.toUpperCase())
        .replace(/^[^a-zA-Z]+/, "")
        .replace(/^./, (chr) => chr.toLowerCase()) || `rating${index + 1}`;
    const weight = Number.parseFloat(toDbText(candidate.weight) ?? "1");
    result.push({
      id,
      label,
      weight: Number.isFinite(weight) && weight > 0 ? String(weight) : "1",
    });
    return result;
  }, []);
  return { fields: normalized.length ? normalized : defaultFirmRatingConfig.fields };
}

function readRatingValues(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const values: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    const text = toDbText(item);
    if (text) values[key] = text;
  }
  return values;
}

function calculateFirmRatingScore(values: Record<string, string>, config: FirmRatingConfig) {
  let weightedTotal = 0;
  let weightTotal = 0;
  for (const field of config.fields) {
    const rawValue = values[field.id];
    if (!rawValue) continue;
    const score = Number.parseFloat(rawValue);
    const weight = Number.parseFloat(field.weight ?? "1");
    if (!Number.isFinite(score) || !Number.isFinite(weight) || weight <= 0) continue;
    weightedTotal += score * weight;
    weightTotal += weight;
  }
  return weightTotal > 0 ? weightedTotal / weightTotal : undefined;
}

function formatFirmRatingScore(score: number | undefined) {
  if (score === undefined || !Number.isFinite(score)) return undefined;
  return score.toFixed(2).replace(/\.?0+$/, "");
}

async function getFirmRatingConfig() {
  const result = await pool.query<{ firm_rating_config: unknown }>(
    "select firm_rating_config from app_settings where id = true",
  );
  return normalizeFirmRatingConfig(result.rows[0]?.firm_rating_config);
}

async function getAverageFirmRatings(firms: MasterFirmRow[]) {
  const firmUniqueNos = firms
    .map((firm) => fromDbText(firm.firm_unique_no)?.toLowerCase())
    .filter((value): value is string => Boolean(value));
  const firmNames = firms
    .map((firm) => fromDbText(firm.firm_name)?.toLowerCase())
    .filter((value): value is string => Boolean(value));
  if (!firmUniqueNos.length && !firmNames.length) return new Map<string, string>();

  const config = await getFirmRatingConfig();
  const result = await pool.query<SupplyOrderRatingRow>(
    `select firm, firm_unique_no, firm_rating_values
     from supply_orders
     where firm_rating_values <> '{}'::jsonb
       and (
         lower(coalesce(firm_unique_no, '')) = any($1::text[])
         or lower(coalesce(firm, '')) = any($2::text[])
       )`,
    [firmUniqueNos, firmNames],
  );
  const scoresByFirmId = new Map<string, number[]>();

  for (const order of result.rows) {
    const orderUniqueNo = fromDbText(order.firm_unique_no)?.toLowerCase();
    const orderFirmName = fromDbText(order.firm)?.toLowerCase();
    const score = calculateFirmRatingScore(readRatingValues(order.firm_rating_values), config);
    if (score === undefined) continue;

    for (const firm of firms) {
      const firmUniqueNo = fromDbText(firm.firm_unique_no)?.toLowerCase();
      const firmName = fromDbText(firm.firm_name)?.toLowerCase();
      const matchesUniqueNo = Boolean(
        firmUniqueNo && orderUniqueNo && firmUniqueNo === orderUniqueNo,
      );
      const matchesName = Boolean(
        !matchesUniqueNo && firmName && orderFirmName && firmName === orderFirmName,
      );
      if (!matchesUniqueNo && !matchesName) continue;
      const scores = scoresByFirmId.get(firm.id) ?? [];
      scores.push(score);
      scoresByFirmId.set(firm.id, scores);
    }
  }

  const averages = new Map<string, string>();
  for (const [firmId, scores] of scoresByFirmId) {
    const average = scores.reduce((total, score) => total + score, 0) / scores.length;
    const formatted = formatFirmRatingScore(average);
    if (formatted) averages.set(firmId, formatted);
  }
  return averages;
}

function readPositiveInteger(value: unknown, fallback: number, max: number) {
  const parsed =
    typeof value === "string" || typeof value === "number"
      ? Number.parseInt(String(value), 10)
      : Number.NaN;
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

function canManageFirms(user: AuthUser) {
  return canMutateFiles(user);
}

async function verifyDeletionPassword(value: unknown) {
  if (typeof value !== "string") throw new HttpError(400, "Deletion password is required.");
  const result = await pool.query<{ ok: boolean; configured: boolean }>(
    `select
       deletion_password <> '' as configured,
       deletion_password <> '' and deletion_password = $1 as ok
     from app_settings
     where id = true`,
    [value],
  );
  if (!result.rows[0]?.configured) {
    throw new HttpError(400, "Set a deletion password in admin settings before deleting firms.");
  }
  if (!result.rows[0].ok) throw new HttpError(403, "Incorrect deletion password.");
}

function readFirmPayload(body: Record<string, unknown>) {
  const firmName = toDbText(body.firmName);
  const emailId = toDbText(body.emailId);
  const city = toDbText(body.city);
  const address = toDbText(body.address);
  const firmUniqueNo = toDbText(body.firmUniqueNo);
  const contactNo = toDbText(body.contactNo);
  if (emailId && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailId)) {
    throw new HttpError(400, "Enter a valid email id.");
  }
  if (contactNo && !/^\d+$/.test(contactNo)) {
    throw new HttpError(400, "Contact No. must contain numbers only.");
  }
  if (!firmName && !emailId && !firmUniqueNo) {
    throw new HttpError(400, "Enter firm name, email id, or Firm Unique No.");
  }
  return { firmName, emailId, city, address, firmUniqueNo, contactNo };
}

function isUniqueViolation(error: unknown) {
  return Boolean(
    error && typeof error === "object" && (error as { code?: string }).code === "23505",
  );
}

async function getFirm(id: string, includeArchived = false) {
  const result = await pool.query<MasterFirmRow>(
    `select mf.*, u.name as created_by_name
     from master_firms mf
     left join app_users u on u.id = mf.created_by
     where mf.id = $1
       and ($2::boolean or mf.archived_at is null)`,
    [id, includeArchived],
  );
  return result.rows[0] ? mapFirm(result.rows[0]) : undefined;
}

firmsRouter.get(
  "/",
  asyncHandler(async (request, response) => {
    requireAuth(request as AuthRequest);
    const values: unknown[] = [];
    const where: string[] = ["mf.archived_at is null"];
    const q = typeof request.query.q === "string" ? request.query.q.trim() : "";
    const page = readPositiveInteger(request.query.page, 1, 1_000_000);
    const pageSize = readPositiveInteger(request.query.pageSize, 50, 500);
    const offset = (page - 1) * pageSize;

    if (q) {
      values.push(`%${q.toLowerCase()}%`);
      where.push(
        `(lower(coalesce(mf.firm_name, '')) like $${values.length}
          or lower(coalesce(mf.email_id, '')) like $${values.length}
          or lower(coalesce(mf.firm_unique_no, '')) like $${values.length}
          or lower(coalesce(mf.contact_no, '')) like $${values.length})`,
      );
    }

    const whereSql = where.length ? `where ${where.join(" and ")}` : "";
    const count = await pool.query<{ count: string }>(
      `select count(*)::text as count from master_firms mf ${whereSql}`,
      values,
    );
    const total = Number.parseInt(count.rows[0]?.count ?? "0", 10);
    values.push(pageSize, offset);
    const result = await pool.query<MasterFirmRow>(
      `select mf.*, u.name as created_by_name
       from master_firms mf
       left join app_users u on u.id = mf.created_by
       ${whereSql}
       order by lower(coalesce(mf.firm_name, '')) asc, lower(coalesce(mf.email_id, '')) asc, mf.created_at desc
       limit $${values.length - 1} offset $${values.length}`,
      values,
    );
    const ratings = await getAverageFirmRatings(result.rows);

    response.json({
      firms: result.rows.map((row) => mapFirm({ ...row, firm_rating: ratings.get(row.id) })),
      total,
      page,
      pageSize,
    });
  }),
);

firmsRouter.post(
  "/",
  asyncHandler(async (request, response) => {
    const user = requireAuth(request as AuthRequest);
    if (!canManageFirms(user)) throw new HttpError(403, "You cannot add firms.");
    const payload = readFirmPayload(requireObjectBody(request.body));
    try {
      const result = await pool.query<MasterFirmRow>(
        `insert into master_firms (firm_name, email_id, city, address, firm_unique_no, contact_no, created_by)
         values ($1, $2, $3, $4, $5, $6, $7)
         returning *, null::text as created_by_name`,
        [
          payload.firmName,
          payload.emailId,
          payload.city,
          payload.address,
          payload.firmUniqueNo,
          payload.contactNo,
          user.id,
        ],
      );
      response.status(201).json({ firm: mapFirm(result.rows[0]) });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new HttpError(409, "Firm Unique No. already exists.");
      }
      throw error;
    }
  }),
);

firmsRouter.patch(
  "/:id",
  asyncHandler(async (request, response) => {
    const user = requireAuth(request as AuthRequest);
    if (!canManageFirms(user)) throw new HttpError(403, "You cannot edit firms.");
    const id = requireParam(request.params.id, "id");
    const payload = readFirmPayload(requireObjectBody(request.body));
    try {
      const result = await pool.query<MasterFirmRow>(
        `update master_firms
         set firm_name = $2, email_id = $3, city = $4, address = $5, firm_unique_no = $6, contact_no = $7
         where id = $1 and archived_at is null
         returning *, null::text as created_by_name`,
        [
          id,
          payload.firmName,
          payload.emailId,
          payload.city,
          payload.address,
          payload.firmUniqueNo,
          payload.contactNo,
        ],
      );
      if (!result.rows[0]) throw new HttpError(404, "Firm was not found.");
      response.json({ firm: mapFirm(result.rows[0]) });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new HttpError(409, "Firm Unique No. already exists.");
      }
      throw error;
    }
  }),
);

firmsRouter.delete(
  "/:id",
  asyncHandler(async (request, response) => {
    const user = requireAuth(request as AuthRequest);
    if (!canManageFirms(user)) throw new HttpError(403, "You cannot delete firms.");
    const id = requireParam(request.params.id, "id");
    const firm = await getFirm(id);
    if (!firm) throw new HttpError(404, "Firm was not found.");
    await pool.query(
      `update master_firms
       set archived_at = now(),
           archived_by = $2,
           archive_reason = 'Archived by admin'
       where id = $1 and archived_at is null`,
      [id, user.id],
    );
    response.json({ archived: true, firm });
  }),
);

firmsRouter.get(
  "/archive/list",
  asyncHandler(async (request, response) => {
    const user = requireAuth(request as AuthRequest);
    if (!canManageFirms(user)) throw new HttpError(403, "You cannot view archived firms.");
    const result = await pool.query<MasterFirmRow>(
      `select mf.*, u.name as created_by_name
       from master_firms mf
       left join app_users u on u.id = mf.created_by
       where mf.archived_at is not null
       order by mf.archived_at desc, lower(coalesce(mf.firm_name, '')) asc`,
    );
    response.json({ firms: result.rows.map(mapFirm) });
  }),
);

firmsRouter.post(
  "/archive/:id/restore",
  asyncHandler(async (request, response) => {
    const user = requireAuth(request as AuthRequest);
    if (!canManageFirms(user)) throw new HttpError(403, "You cannot restore firms.");
    const id = requireParam(request.params.id, "id");
    const firm = await getFirm(id, true);
    if (!firm?.archivedAt) throw new HttpError(404, "Archived firm was not found.");
    try {
      await pool.query(
        `update master_firms
         set archived_at = null,
             archived_by = null,
             archive_reason = null
         where id = $1`,
        [id],
      );
      response.json({ firm: await getFirm(id) });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new HttpError(409, "Firm Unique No. already exists in active firms.");
      }
      throw error;
    }
  }),
);

firmsRouter.delete(
  "/archive/:id",
  asyncHandler(async (request, response) => {
    const user = requireAuth(request as AuthRequest);
    if (user.role !== "admin") throw new HttpError(403, "Admin access required.");
    const body = requireObjectBody(request.body);
    await verifyDeletionPassword(body.deletionPassword);
    const id = requireParam(request.params.id, "id");
    const firm = await getFirm(id, true);
    if (!firm?.archivedAt) throw new HttpError(404, "Archived firm was not found.");
    await pool.query("delete from master_firms where id = $1 and archived_at is not null", [id]);
    response.json({ deleted: true, firm });
  }),
);
