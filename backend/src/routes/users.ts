import { Router } from "express";
import { pool } from "../db/pool.js";
import type { AppUser, AppUserRole, UniversalViewerCashOutgoEditScope } from "../types.js";
import {
  canUseAllDivisions,
  ensureUserPermissionSchema,
  requireAdmin,
  requireAuth,
  type AuthRequest,
} from "../utils/auth.js";
import { cacheTtl, clearCachePrefix, getCached } from "../utils/cache.js";
import { normalizeFileCategories } from "../utils/file-categories.js";
import { ensureIpAccessControlSchema } from "../utils/ip-access-control.js";
import {
  asyncHandler,
  HttpError,
  requireObjectBody,
  requireParam,
  requireString,
} from "../utils/http.js";

export const usersRouter = Router();

usersRouter.use((request, response, next) => {
  if (request.method !== "GET") {
    response.on("finish", () => {
      if (response.statusCode >= 200 && response.statusCode < 300) {
        clearUserCache();
      }
    });
  }
  next();
});

const allowedRoles = new Set<AppUserRole>([
  "admin",
  "sub_admin",
  "division_user",
  "editor",
  "viewer",
  "universal_viewer",
]);

type UserRow = {
  id: string;
  name: string;
  username: string;
  role: AppUserRole;
  division_ids: string[] | null;
  allowed_file_categories: unknown;
  cash_outgo_edit_scope: UniversalViewerCashOutgoEditScope;
  emergency_ip_bypass: boolean;
  archived_at: Date | string | null;
};

function mapUser(row: UserRow): AppUser {
  return {
    id: row.id,
    name: row.name,
    username: row.username,
    role: row.role,
    divisionIds: row.division_ids ?? [],
    allowedFileCategories: Array.isArray(row.allowed_file_categories)
      ? normalizeFileCategories(
          row.allowed_file_categories.filter((item): item is string => typeof item === "string"),
        )
      : undefined,
    cashOutgoEditScope: row.cash_outgo_edit_scope ?? "none",
    emergencyIpBypass: Boolean(row.emergency_ip_bypass),
    archivedAt: row.archived_at ? new Date(row.archived_at).toISOString() : undefined,
  };
}

function readRole(value: unknown) {
  if (typeof value !== "string" || !allowedRoles.has(value as AppUserRole)) {
    throw new HttpError(
      400,
      "role must be admin, sub_admin, division_user, editor, viewer, or universal_viewer.",
    );
  }
  return value as AppUserRole;
}

function readDivisionIds(value: unknown) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new HttpError(400, "divisionIds must be an array of division ids.");
  }
  return value as string[];
}

function readAllowedFileCategories(value: unknown) {
  if (value === undefined) return undefined;
  if (value === null) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new HttpError(400, "allowedFileCategories must be an array of file category keys.");
  }
  return normalizeFileCategories(value);
}

function readCashOutgoEditScope(value: unknown): UniversalViewerCashOutgoEditScope | undefined {
  if (value === undefined) return undefined;
  if (value === "none" || value === "personal" || value === "global") return value;
  throw new HttpError(400, "cashOutgoEditScope must be none, personal, or global.");
}

function clearUserCache() {
  clearCachePrefix("auth:");
  clearCachePrefix("lookup:users");
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
    throw new HttpError(400, "Set a deletion password in admin settings before deleting users.");
  }
  if (!result.rows[0].ok) throw new HttpError(403, "Incorrect deletion password.");
}

async function listUsers(includeArchived = false) {
  await ensureIpAccessControlSchema();
  await ensureUserPermissionSchema();
  const cacheKey = includeArchived ? "lookup:users:archived" : "lookup:users";
  return getCached(cacheKey, cacheTtl.lookupMs, async () => {
    const result = await pool.query<UserRow>(
      `select
         u.id,
         u.name,
         u.username,
         u.role,
         u.cash_outgo_edit_scope,
         u.emergency_ip_bypass,
         u.allowed_file_categories,
         u.archived_at,
         coalesce(
           array_agg(ud.division_id::text order by d.name) filter (where ud.division_id is not null),
           array[]::text[]
         ) as division_ids
       from app_users u
       left join user_divisions ud on ud.user_id = u.id
       left join divisions d on d.id = ud.division_id
       where ${includeArchived ? "u.archived_at is not null" : "u.archived_at is null"}
       group by u.id
       order by u.name asc`,
    );
    return result.rows.map(mapUser);
  });
}

async function getUser(id: string) {
  const users = await listUsers();
  return users.find((user) => user.id === id);
}

async function getArchivedUser(id: string) {
  const users = await listUsers(true);
  return users.find((user) => user.id === id);
}

async function ensureNotLastAdmin(userId: string, action: string) {
  const result = await pool.query<{ remaining_admins: string }>(
    `select count(*)::text as remaining_admins
     from app_users
     where role = 'admin'
       and is_active = true
       and id <> $1`,
    [userId],
  );
  if (Number(result.rows[0]?.remaining_admins ?? 0) === 0) {
    throw new HttpError(400, `Cannot ${action} the last active admin user.`);
  }
}

usersRouter.get(
  "/",
  asyncHandler(async (request, response) => {
    const user = requireAuth(request as AuthRequest);
    if (!canUseAllDivisions(user)) throw new HttpError(403, "Admin access required.");
    response.json({ users: await listUsers() });
  }),
);

usersRouter.post(
  "/",
  asyncHandler(async (request, response) => {
    requireAdmin(request as AuthRequest);
    const body = requireObjectBody(request.body);
    const name = requireString(body.name, "name");
    const username = requireString(body.username, "username");
    const role = readRole(body.role ?? "editor");
    const password = requireString(body.password, "password");
    const divisionIds = readDivisionIds(body.divisionIds) ?? [];
    const allowedFileCategories = readAllowedFileCategories(body.allowedFileCategories);
    const cashOutgoEditScope =
      role === "universal_viewer"
        ? (readCashOutgoEditScope(body.cashOutgoEditScope) ?? "none")
        : "none";
    const emergencyIpBypass = body.emergencyIpBypass === true && role === "admin";

    const client = await pool.connect();
    try {
      await ensureIpAccessControlSchema();
      await ensureUserPermissionSchema();
      await client.query("begin");
      const result = await client.query<{ id: string }>(
        `insert into app_users (
           name, username, role, password_hash, is_active, allowed_file_categories,
           cash_outgo_edit_scope, emergency_ip_bypass
         )
         values ($1, $2, $3, crypt($4, gen_salt('bf')), true, $5::jsonb, $6, $7)
         returning id`,
        [
          name,
          username,
          role,
          password,
          allowedFileCategories ? JSON.stringify(allowedFileCategories) : null,
          cashOutgoEditScope,
          emergencyIpBypass,
        ],
      );
      const userId = result.rows[0].id;
      for (const divisionId of divisionIds) {
        await client.query(
          `insert into user_divisions (user_id, division_id)
           values ($1, $2)
           on conflict do nothing`,
          [userId, divisionId],
        );
      }
      await client.query("commit");
      clearUserCache();
      response.status(201).json({ user: await getUser(userId) });
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }),
);

usersRouter.patch(
  "/:id",
  asyncHandler(async (request, response) => {
    requireAdmin(request as AuthRequest);
    const body = requireObjectBody(request.body);
    const id = requireParam(request.params.id, "id");
    const fields: string[] = [];
    const values: unknown[] = [];
    const divisionIds = readDivisionIds(body.divisionIds);
    const allowedFileCategories = readAllowedFileCategories(body.allowedFileCategories);
    const nextRole = "role" in body ? readRole(body.role) : undefined;
    const cashOutgoEditScope = readCashOutgoEditScope(body.cashOutgoEditScope);

    const addField = (column: string, value: unknown) => {
      values.push(value);
      fields.push(`${column} = $${values.length}`);
    };

    if ("name" in body) addField("name", requireString(body.name, "name"));
    if ("username" in body) addField("username", requireString(body.username, "username"));
    if ("role" in body) addField("role", nextRole);
    if ("password" in body) addField("password_hash", requireString(body.password, "password"));
    if ("emergencyIpBypass" in body) addField("emergency_ip_bypass", body.emergencyIpBypass === true);
    if ("allowedFileCategories" in body) {
      values.push(allowedFileCategories ? JSON.stringify(allowedFileCategories) : null);
      fields.push(`allowed_file_categories = $${values.length}::jsonb`);
    }

    const client = await pool.connect();
    try {
      await ensureIpAccessControlSchema();
      await ensureUserPermissionSchema();
      await client.query("begin");
      const existing = await client.query<{ id: string; role: AppUserRole; is_active: boolean }>(
        "select id, role, is_active from app_users where id = $1",
        [id],
      );
      if (existing.rowCount === 0) throw new HttpError(404, "User not found.");
      if ("cashOutgoEditScope" in body || nextRole) {
        const targetRole = nextRole ?? existing.rows[0].role;
        addField(
          "cash_outgo_edit_scope",
          targetRole === "universal_viewer" ? (cashOutgoEditScope ?? "none") : "none",
        );
      }
      if (
        existing.rows[0].role === "admin" &&
        existing.rows[0].is_active &&
        "role" in body &&
        readRole(body.role) !== "admin"
      ) {
        await ensureNotLastAdmin(id, "change role for");
      }
      if (fields.length) {
        values.push(id);
        const setSql = fields
          .map((field) =>
            field.startsWith("password_hash = ")
              ? field.replace("password_hash = ", "password_hash = crypt(") + ", gen_salt('bf'))"
              : field,
          )
          .join(", ");
        await client.query(`update app_users set ${setSql} where id = $${values.length}`, values);
      }
      if (divisionIds) {
        await client.query("delete from user_divisions where user_id = $1", [id]);
        for (const divisionId of divisionIds) {
          await client.query(
            `insert into user_divisions (user_id, division_id)
             values ($1, $2)
             on conflict do nothing`,
            [id, divisionId],
          );
        }
      }
      if (!fields.length && !divisionIds) throw new HttpError(400, "No user fields provided.");
      await client.query("commit");
      clearUserCache();
      response.json({ user: await getUser(id) });
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }),
);

usersRouter.delete(
  "/:id",
  asyncHandler(async (request, response) => {
    const admin = requireAdmin(request as AuthRequest);
    const id = requireParam(request.params.id, "id");
    const user = await getUser(id);
    if (!user) throw new HttpError(404, "User not found.");
    if (user.role === "admin") await ensureNotLastAdmin(id, "delete");

    await pool.query(
      `update app_users
       set archived_at = now(),
           archived_by = $2,
           archive_reason = 'Archived by admin',
           is_active = false
       where id = $1 and archived_at is null`,
      [id, admin.id],
    );
    clearUserCache();
    response.json({ archived: true, user });
  }),
);

usersRouter.get(
  "/archive/list",
  asyncHandler(async (request, response) => {
    requireAdmin(request as AuthRequest);
    response.json({ users: await listUsers(true) });
  }),
);

usersRouter.post(
  "/archive/:id/restore",
  asyncHandler(async (request, response) => {
    requireAdmin(request as AuthRequest);
    const id = requireParam(request.params.id, "id");
    const user = await getArchivedUser(id);
    if (!user) throw new HttpError(404, "Archived user not found.");
    await pool.query(
      `update app_users
       set archived_at = null,
           archived_by = null,
           archive_reason = null,
           is_active = true
       where id = $1`,
      [id],
    );
    clearUserCache();
    response.json({ user: await getUser(id) });
  }),
);

usersRouter.delete(
  "/archive/:id",
  asyncHandler(async (request, response) => {
    requireAdmin(request as AuthRequest);
    const body = requireObjectBody(request.body);
    await verifyDeletionPassword(body.deletionPassword);
    const id = requireParam(request.params.id, "id");
    const user = await getArchivedUser(id);
    if (!user) throw new HttpError(404, "Archived user not found.");
    await pool.query("delete from user_divisions where user_id = $1", [id]);
    await pool.query("delete from app_users where id = $1 and archived_at is not null", [id]);
    clearUserCache();
    response.json({ deleted: true, user });
  }),
);
