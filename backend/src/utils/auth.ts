import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { pool } from "../db/pool.js";
import type { AppUserRole, AuthUser } from "../types.js";
import { HttpError } from "./http.js";

const sessionCookieName = "recordkeeper_session";
const sessionDays = 7;
const isProduction = process.env.NODE_ENV === "production";
const sameSiteSetting = readSameSiteSetting(process.env.SESSION_COOKIE_SAMESITE);

export type AuthRequest = Request & {
  authUser?: AuthUser;
};

type SessionRow = {
  user_id: string | null;
  viewer_division_id: string | null;
  viewer_division_name: string | null;
  name: string | null;
  username: string | null;
  role: AppUserRole | null;
  division_ids: string[] | null;
};

function hashToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function parseCookies(header: string | undefined) {
  const cookies = new Map<string, string>();
  for (const part of (header ?? "").split(";")) {
    const [rawName, ...rawValue] = part.trim().split("=");
    if (!rawName || rawValue.length === 0) continue;
    cookies.set(rawName, decodeURIComponent(rawValue.join("=")));
  }
  return cookies;
}

function readSameSiteSetting(value: string | undefined) {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "none" || normalized === "strict" || normalized === "lax") {
    return normalized;
  }
  return "lax";
}

function sessionCookieOptions(maxAge?: number) {
  return {
    httpOnly: true,
    sameSite: sameSiteSetting,
    secure: isProduction || sameSiteSetting === "none",
    ...(maxAge !== undefined ? { maxAge } : {}),
    path: "/",
  } as const;
}

export function getSessionToken(request: Request) {
  return parseCookies(request.headers.cookie).get(sessionCookieName);
}

export function setSessionCookie(response: Response, token: string) {
  const maxAge = sessionDays * 24 * 60 * 60;
  response.cookie(sessionCookieName, token, sessionCookieOptions(maxAge * 1000));
}

export function clearSessionCookie(response: Response) {
  response.clearCookie(sessionCookieName, sessionCookieOptions());
}

export function createSessionToken() {
  return crypto.randomBytes(32).toString("base64url");
}

export async function saveUserSession(userId: string) {
  const token = createSessionToken();
  await pool.query(
    `insert into auth_sessions (token_hash, user_id, expires_at)
     values ($1, $2, now() + ($3 || ' days')::interval)`,
    [hashToken(token), userId, sessionDays],
  );
  return token;
}

export async function saveViewerSession(divisionId: string) {
  const token = createSessionToken();
  await pool.query(
    `insert into auth_sessions (token_hash, viewer_division_id, expires_at)
     values ($1, $2, now() + ($3 || ' days')::interval)`,
    [hashToken(token), divisionId, sessionDays],
  );
  return token;
}

export async function deleteSession(token: string | undefined) {
  if (!token) return;
  await pool.query("delete from auth_sessions where token_hash = $1", [hashToken(token)]);
}

export async function loadAuthUser(request: Request): Promise<AuthUser | undefined> {
  const token = getSessionToken(request);
  if (!token) return undefined;
  const result = await pool.query<SessionRow>(
    `select
       s.user_id,
       s.viewer_division_id,
       vd.name as viewer_division_name,
       u.name,
       u.username,
       u.role,
       coalesce(
         array_agg(ud.division_id::text order by d.name) filter (where ud.division_id is not null),
         array[]::text[]
       ) as division_ids
     from auth_sessions s
     left join app_users u on u.id = s.user_id and u.is_active = true
     left join user_divisions ud on ud.user_id = u.id
     left join divisions d on d.id = ud.division_id
     left join divisions vd on vd.id = s.viewer_division_id
     where s.token_hash = $1 and s.expires_at > now()
     group by s.id, u.id, vd.id`,
    [hashToken(token)],
  );
  const row = result.rows[0];
  if (!row) return undefined;

  if (row.viewer_division_id) {
    return {
      id: `viewer:${row.viewer_division_id}`,
      name: `${row.viewer_division_name ?? "Division"} Viewer`,
      username: row.viewer_division_name ?? "viewer",
      role: "viewer",
      divisionIds: [row.viewer_division_id],
    };
  }

  if (!row.user_id || !row.role || !row.name || !row.username) return undefined;
  return {
    id: row.user_id,
    name: row.name,
    username: row.username,
    role: row.role,
    divisionIds: row.division_ids ?? [],
  };
}

export function attachAuthUser(request: AuthRequest, _response: Response, next: NextFunction) {
  loadAuthUser(request)
    .then((user) => {
      request.authUser = user;
      next();
    })
    .catch(next);
}

export function requireAuth(request: AuthRequest) {
  if (!request.authUser) throw new HttpError(401, "Login required.");
  return request.authUser;
}

export function requireAdmin(request: AuthRequest) {
  const user = requireAuth(request);
  if (user.role !== "admin") throw new HttpError(403, "Admin access required.");
  return user;
}

export function canUseAllDivisions(user: AuthUser) {
  return user.role === "admin" || user.role === "sub_admin";
}

export function canMutateFiles(user: AuthUser) {
  return user.role === "admin" || user.role === "sub_admin" || user.role === "editor";
}

export function canAccessDivision(user: AuthUser, divisionId: string | null | undefined) {
  if (!divisionId) return true;
  if (canUseAllDivisions(user)) return true;
  return user.divisionIds.includes(divisionId);
}

export function getDivisionScopeCondition(user: AuthUser, alias = "f") {
  if (canUseAllDivisions(user)) return { sql: "", values: [] as unknown[] };
  if (user.divisionIds.length === 0) return { sql: "1 = 0", values: [] as unknown[] };
  return {
    sql: `${alias}.division_id = any($1::uuid[])`,
    values: [user.divisionIds],
  };
}
