import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { pool } from "../db/pool.js";
import type { AppUserRole, AuthUser } from "../types.js";
import { cacheTtl, deleteCached, getCached } from "./cache.js";
import { normalizeFileCategories, type FileCategoryKey } from "./file-categories.js";
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
  allowed_file_categories: unknown;
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
  const tokenHash = hashToken(token);
  await pool.query("delete from auth_sessions where token_hash = $1", [tokenHash]);
  deleteCached(`auth:${tokenHash}`);
}

export async function loadAuthUser(request: Request): Promise<AuthUser | undefined> {
  const token = getSessionToken(request);
  if (!token) return undefined;
  const tokenHash = hashToken(token);
  return getCached(`auth:${tokenHash}`, cacheTtl.authSessionMs, async () =>
    loadAuthUserByHash(tokenHash),
  );
}

async function loadAuthUserByHash(tokenHash: string): Promise<AuthUser | undefined> {
  const result = await pool.query<SessionRow>(
    `select
       s.user_id,
       s.viewer_division_id,
       vd.name as viewer_division_name,
       u.name,
       u.username,
       u.role,
       u.allowed_file_categories,
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
    [tokenHash],
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
      allowedFileCategories: undefined,
    };
  }

  const allowedFileCategories = Array.isArray(row.allowed_file_categories)
    ? normalizeFileCategories(
        row.allowed_file_categories.filter((item): item is string => typeof item === "string"),
      )
    : undefined;
  if (!row.user_id || !row.role || !row.name || !row.username) return undefined;
  return {
    id: row.user_id,
    name: row.name,
    username: row.username,
    role: row.role,
    divisionIds: row.division_ids ?? [],
    allowedFileCategories,
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

export function getAllowedFileCategories(user: AuthUser): FileCategoryKey[] | undefined {
  if (user.role !== "editor") return undefined;
  return normalizeFileCategories(user.allowedFileCategories ?? undefined);
}

export function hasFileCategoryRestriction(user: AuthUser) {
  return user.role === "editor" && Array.isArray(user.allowedFileCategories);
}

export function canAccessFileCategory(user: AuthUser, file: { fileType?: string; mode?: string }) {
  const categories = getAllowedFileCategories(user);
  if (!categories) return true;
  const fileType = (file.fileType ?? "").trim().toLowerCase();
  return categories.some((category) => {
    if (category === "cars") return fileType === "cars";
    if (category === "amc") return fileType === "amc";
    if (category === "mpc") return fileType === "mpc";
    if (category === "om") return fileType === "o&m";
    return fileType !== "amc" && fileType !== "mpc" && fileType !== "cars" && fileType !== "o&m";
  });
}

export function getDivisionScopeCondition(user: AuthUser, alias = "f") {
  if (canUseAllDivisions(user)) return { sql: "", values: [] as unknown[] };
  if (user.divisionIds.length === 0) return { sql: "1 = 0", values: [] as unknown[] };
  return {
    sql: `${alias}.division_id = any($1::uuid[])`,
    values: [user.divisionIds],
  };
}

export function getFileCategoryScopeCondition(user: AuthUser, alias = "f") {
  const categories = getAllowedFileCategories(user);
  if (!categories) return { sql: "", values: [] as unknown[] };
  if (categories.length === 0) return { sql: "1 = 0", values: [] as unknown[] };
  const categorySet = new Set(categories);
  const predicates: string[] = [];
  if (categorySet.has("goodsServices")) {
    predicates.push(
      `lower(trim(coalesce(${alias}.file_type, ''))) not in ('amc', 'mpc', 'cars', 'o&m')`,
    );
  }
  if (categorySet.has("amc")) {
    predicates.push(`lower(trim(coalesce(${alias}.file_type, ''))) = 'amc'`);
  }
  if (categorySet.has("mpc")) {
    predicates.push(`lower(trim(coalesce(${alias}.file_type, ''))) = 'mpc'`);
  }
  if (categorySet.has("cars")) {
    predicates.push(`lower(trim(coalesce(${alias}.file_type, ''))) = 'cars'`);
  }
  if (categorySet.has("om")) {
    predicates.push(`lower(trim(coalesce(${alias}.file_type, ''))) = 'o&m'`);
  }
  return { sql: predicates.length ? `(${predicates.join(" or ")})` : "1 = 0", values: [] };
}

export function getAuthScopeCacheKey(user: AuthUser) {
  const divisions = canUseAllDivisions(user) ? "all" : [...user.divisionIds].sort().join(",") || "none";
  const categories = hasFileCategoryRestriction(user)
    ? normalizeFileCategories(user.allowedFileCategories ?? undefined).join(",")
    : "all-categories";
  return `${divisions}:${categories}`;
}
