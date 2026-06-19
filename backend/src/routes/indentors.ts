import { Router } from "express";
import { pool } from "../db/pool.js";
import type { AuthUser, Indentor } from "../types.js";
import {
  canAccessDivision,
  canUseAllDivisions,
  requireAuth,
  type AuthRequest,
} from "../utils/auth.js";
import {
  asyncHandler,
  HttpError,
  requireObjectBody,
  requireParam,
  requireString,
} from "../utils/http.js";

export const indentorsRouter = Router();

type IndentorRow = {
  id: string;
  division_id: string;
  division_name: string;
  name: string;
  sf_id: string;
  designation: string;
  mobile_no: string;
  landline_no: string;
  email: string;
  created_by: string | null;
  created_by_name: string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

function mapIndentor(row: IndentorRow): Indentor {
  return {
    id: row.id,
    divisionId: row.division_id,
    divisionName: row.division_name,
    name: row.name,
    sfId: row.sf_id,
    designation: row.designation,
    mobileNo: row.mobile_no,
    landlineNo: row.landline_no,
    email: row.email,
    createdBy: row.created_by ?? undefined,
    createdByName: row.created_by_name ?? undefined,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function canManageIndentors(user: AuthUser) {
  return user.role === "admin" || user.role === "sub_admin";
}

function readTrimmed(value: unknown, field: string) {
  return requireString(value, field);
}

function readPositiveInteger(value: unknown, fallback: number, max: number) {
  const parsed =
    typeof value === "string" || typeof value === "number"
      ? Number.parseInt(String(value), 10)
      : Number.NaN;
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

async function assertDivisionAccess(user: AuthUser, divisionId: string) {
  const division = await pool.query<{ id: string }>(
    "select id from divisions where id = $1 and archived_at is null",
    [divisionId],
  );
  if (!division.rows[0]) throw new HttpError(400, "Division was not found.");
  if (!canAccessDivision(user, divisionId)) {
    throw new HttpError(403, "You cannot manage indentors for this division.");
  }
}

async function getIndentor(id: string) {
  const result = await pool.query<IndentorRow>(
    `select
       i.*,
       d.name as division_name,
       u.name as created_by_name
     from indentors i
     join divisions d on d.id = i.division_id
     left join app_users u on u.id = i.created_by
     where i.id = $1`,
    [id],
  );
  return result.rows[0] ? mapIndentor(result.rows[0]) : undefined;
}

indentorsRouter.get(
  "/",
  asyncHandler(async (request, response) => {
    const user = requireAuth(request as AuthRequest);
    const values: unknown[] = [];
    const where: string[] = ["d.archived_at is null"];
    const divisionId =
      typeof request.query.divisionId === "string" && request.query.divisionId.trim()
        ? request.query.divisionId.trim()
        : "";
	    const q =
	      typeof request.query.q === "string" && request.query.q.trim() ? request.query.q.trim() : "";
	    const page = readPositiveInteger(request.query.page, 1, 1_000_000);
	    const pageSize = readPositiveInteger(request.query.pageSize, 50, 200);
	    const offset = (page - 1) * pageSize;

    if (divisionId) {
      if (!canAccessDivision(user, divisionId)) {
        throw new HttpError(403, "You cannot view indentors for this division.");
      }
      values.push(divisionId);
      where.push(`i.division_id = $${values.length}`);
    } else if (!canUseAllDivisions(user)) {
	      if (user.divisionIds.length === 0) {
	        response.json({ indentors: [], total: 0, page, pageSize });
	        return;
	      }
      values.push(user.divisionIds);
      where.push(`i.division_id = any($${values.length}::uuid[])`);
    }

	    if (q) {
	      values.push(`%${q.toLowerCase()}%`);
	      where.push(`(
	        lower(i.name) like $${values.length}
	        or lower(i.sf_id) like $${values.length}
	        or lower(i.designation) like $${values.length}
	        or lower(i.email) like $${values.length}
	      )`);
	    }

	    const totalResult = await pool.query<{ total: string }>(
	      `select count(*)::text as total
	       from indentors i
	       join divisions d on d.id = i.division_id
	       where ${where.join(" and ")}`,
	      values,
	    );
	    const total = Number(totalResult.rows[0]?.total ?? 0);
	    const resultValues = [...values, pageSize, offset];
	    const result = await pool.query<IndentorRow>(
	      `select
	         i.*,
         d.name as division_name,
         u.name as created_by_name
       from indentors i
       join divisions d on d.id = i.division_id
	       left join app_users u on u.id = i.created_by
	       where ${where.join(" and ")}
	       order by d.name asc, i.name asc, i.id asc
	       limit $${values.length + 1}
	       offset $${values.length + 2}`,
	      resultValues,
	    );
	    response.json({ indentors: result.rows.map(mapIndentor), total, page, pageSize });
	  }),
	);

indentorsRouter.post(
  "/",
  asyncHandler(async (request, response) => {
    const user = requireAuth(request as AuthRequest);
    const body = requireObjectBody(request.body);
    const divisionId =
      typeof body.divisionId === "string" && body.divisionId.trim()
        ? body.divisionId.trim()
        : user.divisionIds.length === 1
          ? user.divisionIds[0]
          : "";
    if (!divisionId) throw new HttpError(400, "divisionId is required.");
    await assertDivisionAccess(user, divisionId);

    const result = await pool.query<{ id: string }>(
      `insert into indentors (
         division_id, name, sf_id, designation, mobile_no, landline_no, email, created_by
       )
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       returning id`,
      [
        divisionId,
        readTrimmed(body.name, "name"),
        readTrimmed(body.sfId, "SF ID"),
        readTrimmed(body.designation, "designation"),
        readTrimmed(body.mobileNo, "mobile no."),
        readTrimmed(body.landlineNo, "landline no."),
        readTrimmed(body.email, "email id"),
        user.id.startsWith("viewer:") ? null : user.id,
      ],
    );
    response.status(201).json({ indentor: await getIndentor(result.rows[0].id) });
  }),
);

indentorsRouter.patch(
  "/:id",
  asyncHandler(async (request, response) => {
    const user = requireAuth(request as AuthRequest);
    if (!canManageIndentors(user)) throw new HttpError(403, "Admin access required.");
    const id = requireParam(request.params.id, "id");
    const body = requireObjectBody(request.body);
    const existing = await getIndentor(id);
    if (!existing) throw new HttpError(404, "Indentor was not found.");
    const divisionId =
      typeof body.divisionId === "string" && body.divisionId.trim()
        ? body.divisionId.trim()
        : existing.divisionId;
    await assertDivisionAccess(user, divisionId);

    await pool.query(
      `update indentors
       set division_id = $2,
           name = $3,
           sf_id = $4,
           designation = $5,
           mobile_no = $6,
           landline_no = $7,
           email = $8
       where id = $1`,
      [
        id,
        divisionId,
        readTrimmed(body.name, "name"),
        readTrimmed(body.sfId, "SF ID"),
        readTrimmed(body.designation, "designation"),
        readTrimmed(body.mobileNo, "mobile no."),
        readTrimmed(body.landlineNo, "landline no."),
        readTrimmed(body.email, "email id"),
      ],
    );
    response.json({ indentor: await getIndentor(id) });
  }),
);

indentorsRouter.delete(
  "/:id",
  asyncHandler(async (request, response) => {
    const user = requireAuth(request as AuthRequest);
    if (!canManageIndentors(user)) throw new HttpError(403, "Admin access required.");
    const id = requireParam(request.params.id, "id");
    const existing = await getIndentor(id);
    if (!existing) throw new HttpError(404, "Indentor was not found.");
    await assertDivisionAccess(user, existing.divisionId);
    await pool.query("delete from indentors where id = $1", [id]);
    response.json({ deleted: true, indentor: existing });
  }),
);
