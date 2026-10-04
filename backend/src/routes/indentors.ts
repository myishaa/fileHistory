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

type IndentorTransferScope = "active" | "financialYear" | "all";

let optionalSfIdIndexReady: Promise<void> | undefined;

function ensureOptionalSfIdIndex() {
  optionalSfIdIndexReady ??= pool
    .query(`
      create unique index if not exists indentors_division_sf_id_nonempty_active_key
      on indentors (division_id, sf_id)
      where archived_at is null and nullif(btrim(sf_id), '') is not null
    `)
    .then(async () => {
      await pool.query("drop index if exists indentors_division_sf_id_active_key");
    })
    .then(() => undefined);
  return optionalSfIdIndexReady;
}

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
  archived_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

type IndentorTransferPreviewRow = {
  id: string;
  unique_code: string | null;
  imms: string | null;
  file_no: string | null;
  title: string | null;
  division: string | null;
  year: string | null;
  file_closure_date: string | null;
};

async function ensureIndentorTransferHistoryTable() {
  await pool.query(`
    create table if not exists file_indentor_history (
      id uuid primary key default gen_random_uuid(),
      file_id uuid not null references files(id) on delete cascade,
      from_indentor_id uuid references indentors(id) on delete set null,
      to_indentor_id uuid references indentors(id) on delete set null,
      from_indentor_name text not null,
      to_indentor_name text not null,
      from_division_id uuid references divisions(id) on delete set null,
      to_division_id uuid references divisions(id) on delete set null,
      transfer_scope text not null,
      financial_year text,
      reason text,
      transferred_by_user_id uuid references app_users(id) on delete set null,
      transferred_by_name text,
      transferred_at timestamptz not null default now()
    )
  `);
  await pool.query(
    "create index if not exists file_indentor_history_file_idx on file_indentor_history(file_id)",
  );
  await pool.query(
    "create index if not exists file_indentor_history_indentor_idx on file_indentor_history(from_indentor_id, to_indentor_id)",
  );
  await pool.query(
    "create index if not exists file_indentor_history_transferred_at_idx on file_indentor_history(transferred_at desc)",
  );
}

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
    archivedAt: row.archived_at ? new Date(row.archived_at).toISOString() : undefined,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function canManageIndentors(user: AuthUser) {
  return user.role === "admin" || user.role === "sub_admin";
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
    throw new HttpError(
      400,
      "Set a deletion password in admin settings before deleting indentors.",
    );
  }
  if (!result.rows[0].ok) throw new HttpError(403, "Incorrect deletion password.");
}

function isUniqueViolation(error: unknown) {
  return Boolean(
    error && typeof error === "object" && (error as { code?: string }).code === "23505",
  );
}

function readTrimmed(value: unknown, field: string) {
  return requireString(value, field);
}

function readOptionalText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readOptionalIndentorField(value: unknown, field: string) {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") throw new HttpError(400, `${field} must be text.`);
  return value.trim();
}

function readTransferScope(value: unknown): IndentorTransferScope {
  return value === "active" || value === "financialYear" || value === "all" ? value : "active";
}

function readExpectedCount(value: unknown) {
  const count = typeof value === "number" || typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isInteger(count) || count < 0) {
    throw new HttpError(400, "expectedCount must be a non-negative integer.");
  }
  return count;
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

async function getIndentor(id: string, includeArchived = false) {
  const result = await pool.query<IndentorRow>(
    `select
       i.*,
       d.name as division_name,
       u.name as created_by_name
     from indentors i
     join divisions d on d.id = i.division_id
     left join app_users u on u.id = i.created_by
     where i.id = $1
       and ($2::boolean or i.archived_at is null)`,
    [id, includeArchived],
  );
  return result.rows[0] ? mapIndentor(result.rows[0]) : undefined;
}

async function assertIndentorUnusedBeforeArchive(indentor: Indentor) {
  const result = await pool.query<{ count: string }>(
    `select count(*)::text as count
     from files
     where lower(trim(coalesce(indentor, ''))) = lower(trim($1::text))
       and division_id = $2`,
    [indentor.name, indentor.divisionId],
  );
  const count = Number(result.rows[0]?.count ?? 0);
  if (count > 0) {
    throw new HttpError(
      400,
      `This indentor is used in ${count} file${count === 1 ? "" : "s"}, including Archive. Historical references are protected.`,
    );
  }
}

function buildIndentorTransferWhere(
  source: Indentor,
  scope: IndentorTransferScope,
  financialYear: string | undefined,
) {
  const values: unknown[] = [source.name];
  const where = ["f.archived_at is null", "lower(trim(f.indentor)) = lower(trim($1::text))"];
  if (scope === "active") {
    where.push("f.file_closure_date is null");
  } else if (scope === "financialYear") {
    values.push(financialYear);
    where.push(`f.year = $${values.length}`);
  }
  return { where, values };
}

async function getIndentorTransferCandidates(
  source: Indentor,
  scope: IndentorTransferScope,
  financialYear: string | undefined,
  limit = 25,
) {
  const { where, values } = buildIndentorTransferWhere(source, scope, financialYear);
  const countResult = await pool.query<{ count: string }>(
    `select count(*)::text as count
     from files f
     where ${where.join(" and ")}`,
    values,
  );
  const listValues = [...values, limit];
  const result = await pool.query<IndentorTransferPreviewRow>(
    `select
       f.id,
       f.unique_code,
       f.imms,
       f.file_no,
       f.title,
       d.name as division,
       f.year,
       f.file_closure_date
     from files f
     left join divisions d on d.id = f.division_id
     where ${where.join(" and ")}
     order by f.created_at desc, f.id desc
     limit $${listValues.length}`,
    listValues,
  );
  return {
    count: Number(countResult.rows[0]?.count ?? 0),
    files: result.rows.map((row) => ({
      id: row.id,
      uniqueCode: row.unique_code ?? undefined,
      imms: row.imms ?? undefined,
      fileNo: row.file_no ?? undefined,
      title: row.title ?? undefined,
      division: row.division ?? undefined,
      year: row.year ?? undefined,
      fileClosureDate: row.file_closure_date ?? undefined,
    })),
  };
}

indentorsRouter.get(
  "/",
  asyncHandler(async (request, response) => {
    const user = requireAuth(request as AuthRequest);
    const values: unknown[] = [];
    const where: string[] = ["d.archived_at is null", "i.archived_at is null"];
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
    if (user.role === "universal_viewer") {
      throw new HttpError(403, "You cannot add indentors.");
    }
    const body = requireObjectBody(request.body);
    const divisionId =
      typeof body.divisionId === "string" && body.divisionId.trim()
        ? body.divisionId.trim()
        : user.divisionIds.length === 1
          ? user.divisionIds[0]
          : "";
    if (!divisionId) throw new HttpError(400, "divisionId is required.");
    await assertDivisionAccess(user, divisionId);
    await ensureOptionalSfIdIndex();

    const result = await pool.query<{ id: string }>(
      `insert into indentors (
         division_id, name, sf_id, designation, mobile_no, landline_no, email, created_by
       )
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       returning id`,
      [
        divisionId,
        readTrimmed(body.name, "name"),
        readOptionalIndentorField(body.sfId, "SF ID"),
        readOptionalIndentorField(body.designation, "designation"),
        readOptionalIndentorField(body.mobileNo, "mobile no."),
        readOptionalIndentorField(body.landlineNo, "landline no."),
        readOptionalIndentorField(body.email, "email id"),
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
    await ensureOptionalSfIdIndex();

    await pool.query(
      `update indentors
       set division_id = $2,
           name = $3,
           sf_id = $4,
           designation = $5,
           mobile_no = $6,
           landline_no = $7,
           email = $8
       where id = $1 and archived_at is null`,
      [
        id,
        divisionId,
        readTrimmed(body.name, "name"),
        readOptionalIndentorField(body.sfId, "SF ID"),
        readOptionalIndentorField(body.designation, "designation"),
        readOptionalIndentorField(body.mobileNo, "mobile no."),
        readOptionalIndentorField(body.landlineNo, "landline no."),
        readOptionalIndentorField(body.email, "email id"),
      ],
    );
    response.json({ indentor: await getIndentor(id) });
  }),
);

indentorsRouter.post(
  "/transfer/preview",
  asyncHandler(async (request, response) => {
    const user = requireAuth(request as AuthRequest);
    if (!canManageIndentors(user)) throw new HttpError(403, "Admin access required.");
    const body = requireObjectBody(request.body);
    const sourceIndentorId = requireString(body.sourceIndentorId, "sourceIndentorId");
    const targetIndentorId = requireString(body.targetIndentorId, "targetIndentorId");
    if (sourceIndentorId === targetIndentorId) {
      throw new HttpError(400, "Source and target indentor cannot be same.");
    }
    const scope = readTransferScope(body.scope);
    const financialYear = readOptionalText(body.financialYear);
    if (scope === "financialYear" && !financialYear) {
      throw new HttpError(400, "Financial year is required for selected FY transfer.");
    }

    const source = await getIndentor(sourceIndentorId);
    if (!source) throw new HttpError(404, "Source indentor was not found.");
    const target = await getIndentor(targetIndentorId);
    if (!target) throw new HttpError(404, "Target indentor was not found.");
    await assertDivisionAccess(user, source.divisionId);
    await assertDivisionAccess(user, target.divisionId);

    const preview = await getIndentorTransferCandidates(source, scope, financialYear, 25);
    response.json({ preview: { ...preview, sourceIndentor: source, targetIndentor: target } });
  }),
);

indentorsRouter.post(
  "/transfer",
  asyncHandler(async (request, response) => {
    const user = requireAuth(request as AuthRequest);
    if (!canManageIndentors(user)) throw new HttpError(403, "Admin access required.");
    const body = requireObjectBody(request.body);
    const sourceIndentorId = requireString(body.sourceIndentorId, "sourceIndentorId");
    const targetIndentorId = requireString(body.targetIndentorId, "targetIndentorId");
    if (sourceIndentorId === targetIndentorId) {
      throw new HttpError(400, "Source and target indentor cannot be same.");
    }
    const scope = readTransferScope(body.scope);
    const financialYear = readOptionalText(body.financialYear);
    if (scope === "financialYear" && !financialYear) {
      throw new HttpError(400, "Financial year is required for selected FY transfer.");
    }
    const reason = requireString(body.reason, "reason");
    const expectedCount = readExpectedCount(body.expectedCount);
    if (expectedCount <= 0) throw new HttpError(400, "No affected files to transfer.");
    const archiveSourceIndentor = body.archiveSourceIndentor === true;

    const source = await getIndentor(sourceIndentorId);
    if (!source) throw new HttpError(404, "Source indentor was not found.");
    const target = await getIndentor(targetIndentorId);
    if (!target) throw new HttpError(404, "Target indentor was not found.");
    await assertDivisionAccess(user, source.divisionId);
    await assertDivisionAccess(user, target.divisionId);

    const confirmationText = requireString(body.confirmationText, "confirmationText");
    const requiredConfirmation = `TRANSFER ${expectedCount} FILES`;
    if (confirmationText.trim().toUpperCase() !== requiredConfirmation) {
      throw new HttpError(400, `Type "${requiredConfirmation}" to confirm transfer.`);
    }

    await ensureIndentorTransferHistoryTable();
    const { where, values } = buildIndentorTransferWhere(source, scope, financialYear);
    const currentCount = await pool.query<{ count: string }>(
      `select count(*)::text as count from files f where ${where.join(" and ")}`,
      values,
    );
    if (Number(currentCount.rows[0]?.count ?? 0) !== expectedCount) {
      throw new HttpError(
        409,
        "Affected file count changed after preview. Refresh preview before transferring.",
      );
    }

    const client = await pool.connect();
    let movedFileCount = 0;
    try {
      await client.query("begin");
      const queryValues = [
        ...values,
        target.name,
        target.divisionId,
        source.id,
        target.id,
        source.name,
        scope,
        financialYear ?? null,
        reason,
        user.id.startsWith("viewer:") ? null : user.id,
        user.name,
      ];
      const firstExtra = values.length + 1;
      const result = await client.query<{ file_id: string }>(
        `with candidates as (
           select f.id, f.division_id
           from files f
           where ${where.join(" and ")}
         ),
         history as (
           insert into file_indentor_history (
             file_id,
             from_indentor_id,
             to_indentor_id,
             from_indentor_name,
             to_indentor_name,
             from_division_id,
             to_division_id,
             transfer_scope,
             financial_year,
             reason,
             transferred_by_user_id,
             transferred_by_name
           )
           select
             id,
             $${firstExtra + 2},
             $${firstExtra + 3},
             $${firstExtra + 4},
             $${firstExtra},
             division_id,
             $${firstExtra + 1},
             $${firstExtra + 5},
             $${firstExtra + 6},
             $${firstExtra + 7},
             $${firstExtra + 8},
             $${firstExtra + 9}
           from candidates
           returning file_id
         )
         update files f
         set indentor = $${firstExtra},
             division_id = $${firstExtra + 1}
         from candidates c
         where f.id = c.id
         returning f.id as file_id`,
        queryValues,
      );
      movedFileCount = result.rowCount ?? 0;

      if (archiveSourceIndentor) {
        await client.query(
          `update indentors
           set archived_at = now(),
               archived_by = $2,
               archive_reason = 'Archived after indentor transfer'
           where id = $1 and archived_at is null`,
          [source.id, user.id.startsWith("viewer:") ? null : user.id],
        );
      }

      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }

    response.status(201).json({
      transfer: {
        movedFileCount,
        sourceIndentor: source,
        targetIndentor: target,
        archivedSourceIndentor: archiveSourceIndentor,
      },
    });
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
    await assertIndentorUnusedBeforeArchive(existing);
    await pool.query(
      `update indentors
       set archived_at = now(),
           archived_by = $2,
           archive_reason = 'Archived by admin'
       where id = $1 and archived_at is null`,
      [id, user.id],
    );
    response.json({ archived: true, indentor: existing });
  }),
);

indentorsRouter.get(
  "/archive/list",
  asyncHandler(async (request, response) => {
    const user = requireAuth(request as AuthRequest);
    if (!canManageIndentors(user)) throw new HttpError(403, "Admin access required.");
    const result = await pool.query<IndentorRow>(
      `select
         i.*,
         d.name as division_name,
         u.name as created_by_name
       from indentors i
       join divisions d on d.id = i.division_id
       left join app_users u on u.id = i.created_by
       where i.archived_at is not null
       order by i.archived_at desc, d.name asc, i.name asc`,
    );
    response.json({ indentors: result.rows.map(mapIndentor) });
  }),
);

indentorsRouter.post(
  "/archive/:id/restore",
  asyncHandler(async (request, response) => {
    const user = requireAuth(request as AuthRequest);
    if (!canManageIndentors(user)) throw new HttpError(403, "Admin access required.");
    const id = requireParam(request.params.id, "id");
    const existing = await getIndentor(id, true);
    if (!existing?.archivedAt) throw new HttpError(404, "Archived indentor was not found.");
    await assertDivisionAccess(user, existing.divisionId);
    try {
      await pool.query(
        `update indentors
         set archived_at = null,
             archived_by = null,
             archive_reason = null
         where id = $1`,
        [id],
      );
      response.json({ indentor: await getIndentor(id) });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new HttpError(
          409,
          "An active indentor with this SF ID already exists in the division.",
        );
      }
      throw error;
    }
  }),
);

indentorsRouter.delete(
  "/archive/:id",
  asyncHandler(async (request, response) => {
    const user = requireAuth(request as AuthRequest);
    if (!canManageIndentors(user)) throw new HttpError(403, "Admin access required.");
    const body = requireObjectBody(request.body);
    await verifyDeletionPassword(body.deletionPassword);
    const id = requireParam(request.params.id, "id");
    const existing = await getIndentor(id, true);
    if (!existing?.archivedAt) throw new HttpError(404, "Archived indentor was not found.");
    if (!canAccessDivision(user, existing.divisionId)) {
      throw new HttpError(403, "You cannot manage indentors for this division.");
    }
    await assertIndentorUnusedBeforeArchive(existing);
    await pool.query("delete from indentors where id = $1 and archived_at is not null", [id]);
    response.json({ deleted: true, indentor: existing });
  }),
);
