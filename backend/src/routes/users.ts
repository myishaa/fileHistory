import { Router } from "express";
import { pool } from "../db/pool.js";
import type { AppUser, AppUserRole } from "../types.js";
import { requireAdmin, type AuthRequest } from "../utils/auth.js";
import { cacheTtl, clearCachePrefix, getCached } from "../utils/cache.js";
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
]);

type UserRow = {
  id: string;
  name: string;
  username: string;
  role: AppUserRole;
  division_ids: string[] | null;
};

function mapUser(row: UserRow): AppUser {
  return {
    id: row.id,
    name: row.name,
    username: row.username,
    role: row.role,
    divisionIds: row.division_ids ?? [],
  };
}

function readRole(value: unknown) {
  if (typeof value !== "string" || !allowedRoles.has(value as AppUserRole)) {
    throw new HttpError(400, "role must be admin, sub_admin, editor, or viewer.");
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

function clearUserCache() {
  clearCachePrefix("auth:");
  clearCachePrefix("lookup:users");
}

async function listUsers() {
  return getCached("lookup:users", cacheTtl.lookupMs, async () => {
    const result = await pool.query<UserRow>(
      `select
         u.id,
         u.name,
         u.username,
         u.role,
         coalesce(
           array_agg(ud.division_id::text order by d.name) filter (where ud.division_id is not null),
           array[]::text[]
         ) as division_ids
       from app_users u
       left join user_divisions ud on ud.user_id = u.id
       left join divisions d on d.id = ud.division_id
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
    requireAdmin(request as AuthRequest);
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

    const client = await pool.connect();
    try {
      await client.query("begin");
      const result = await client.query<{ id: string }>(
        `insert into app_users (name, username, role, password_hash, is_active)
         values ($1, $2, $3, crypt($4, gen_salt('bf')), true)
         returning id`,
        [name, username, role, password],
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

    const addField = (column: string, value: unknown) => {
      values.push(value);
      fields.push(`${column} = $${values.length}`);
    };

    if ("name" in body) addField("name", requireString(body.name, "name"));
    if ("username" in body) addField("username", requireString(body.username, "username"));
    if ("role" in body) addField("role", readRole(body.role));
    if ("password" in body) addField("password_hash", requireString(body.password, "password"));

    const client = await pool.connect();
    try {
      await client.query("begin");
      const existing = await client.query<{ id: string; role: AppUserRole; is_active: boolean }>(
        "select id, role, is_active from app_users where id = $1",
        [id],
      );
      if (existing.rowCount === 0) throw new HttpError(404, "User not found.");
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
    requireAdmin(request as AuthRequest);
    const id = requireParam(request.params.id, "id");
    const user = await getUser(id);
    if (!user) throw new HttpError(404, "User not found.");
    if (user.role === "admin") await ensureNotLastAdmin(id, "delete");

    await pool.query("delete from app_users where id = $1", [id]);
    clearUserCache();
    response.json({ deleted: true, user });
  }),
);
