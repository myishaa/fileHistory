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
  created_by: string | null;
  created_by_name: string | null;
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
    createdBy: row.created_by ?? undefined,
    createdByName: row.created_by_name ?? undefined,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
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

async function getFirm(id: string) {
  const result = await pool.query<MasterFirmRow>(
    `select mf.*, u.name as created_by_name
     from master_firms mf
     left join app_users u on u.id = mf.created_by
     where mf.id = $1`,
    [id],
  );
  return result.rows[0] ? mapFirm(result.rows[0]) : undefined;
}

firmsRouter.get(
  "/",
  asyncHandler(async (request, response) => {
    requireAuth(request as AuthRequest);
    const values: unknown[] = [];
    const where: string[] = [];
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

    response.json({ firms: result.rows.map(mapFirm), total, page, pageSize });
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
         where id = $1
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
    await pool.query("delete from master_firms where id = $1", [id]);
    response.json({ deleted: true, firm });
  }),
);
