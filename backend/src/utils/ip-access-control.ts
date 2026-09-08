import type { Request } from "express";
import type { PoolClient } from "pg";
import { pool } from "../db/pool.js";
import type { AppUserRole } from "../types.js";

export type IpAccessMode = "off" | "notify" | "restrict";

type QueryExecutor = Pick<PoolClient, "query"> | typeof pool;

type IpAccessConfigRow = {
  mode: IpAccessMode;
};

type TrustedIpRow = {
  id: string;
  ip_address: string;
  remarks: string | null;
  active: boolean;
  created_by_name: string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

type IpAttemptRow = {
  id: string;
  ip_address: string;
  username: string;
  user_id: string | null;
  user_name: string | null;
  user_role: AppUserRole | null;
  mode: IpAccessMode;
  result: "allowed" | "blocked" | "bypassed";
  reason: string;
  attempted_at: Date | string;
  archived_at: Date | string | null;
  archived_by_name: string | null;
};

export type LoginIpUser = {
  id: string;
  name: string;
  username: string;
  role: AppUserRole;
  emergencyIpBypass?: boolean;
};

let schemaReady: Promise<void> | undefined;

export function getRequestIp(request: Request) {
  const forwarded = String(request.headers["x-forwarded-for"] ?? "")
    .split(",")
    .map((value) => value.trim())
    .find(Boolean);
  return normalizeIpAddress(
    forwarded ||
      String(request.headers["x-real-ip"] ?? "") ||
      request.ip ||
      request.socket.remoteAddress ||
      "",
  );
}

export function normalizeIpAddress(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("::ffff:")) return trimmed.slice("::ffff:".length);
  if (trimmed === "::1") return "127.0.0.1";
  return trimmed;
}

export async function ensureIpAccessControlSchema() {
  schemaReady ??= (async () => {
    await pool.query(`
      alter table app_users
        add column if not exists emergency_ip_bypass boolean not null default false;

      create table if not exists ip_access_settings (
        id boolean primary key default true,
        mode text not null default 'off' check (mode in ('off', 'notify', 'restrict')),
        updated_by_user_id uuid references app_users(id) on delete set null,
        updated_by_name text,
        updated_at timestamptz not null default now()
      );

      insert into ip_access_settings (id, mode)
      values (true, 'off')
      on conflict (id) do nothing;

      create table if not exists trusted_ip_addresses (
        id uuid primary key default gen_random_uuid(),
        ip_address text not null unique,
        remarks text not null default '',
        active boolean not null default true,
        created_by_user_id uuid references app_users(id) on delete set null,
        created_by_name text,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );

      create table if not exists ip_login_attempts (
        id uuid primary key default gen_random_uuid(),
        ip_address text not null,
        username text not null,
        user_id uuid references app_users(id) on delete set null,
        user_name text,
        user_role text,
        mode text not null check (mode in ('off', 'notify', 'restrict')),
        result text not null check (result in ('allowed', 'blocked', 'bypassed')),
        reason text not null,
        attempted_at timestamptz not null default now(),
        archived_at timestamptz,
        archived_by_user_id uuid references app_users(id) on delete set null,
        archived_by_name text
      );

      create index if not exists ip_login_attempts_active_idx
        on ip_login_attempts(archived_at, attempted_at desc);
      create index if not exists trusted_ip_addresses_ip_idx
        on trusted_ip_addresses(ip_address);
    `);
  })();
  await schemaReady;
}

export async function getIpAccessMode() {
  await ensureIpAccessControlSchema();
  const result = await pool.query<IpAccessConfigRow>(
    "select mode from ip_access_settings where id = true",
  );
  return result.rows[0]?.mode ?? "off";
}

export async function isTrustedIp(ipAddress: string) {
  await ensureIpAccessControlSchema();
  const normalized = normalizeIpAddress(ipAddress);
  if (!normalized) return false;
  const result = await pool.query<{ id: string }>(
    "select id from trusted_ip_addresses where ip_address = $1 and active = true",
    [normalized],
  );
  return Boolean(result.rows[0]);
}

export function isEmergencyIpBypassEnabled() {
  return process.env.DISABLE_IP_ALLOWLIST === "true";
}

export async function evaluateLoginIpAccess({
  request,
  username,
  user,
}: {
  request: Request;
  username: string;
  user?: LoginIpUser;
}) {
  const ipAddress = getRequestIp(request);
  const mode = await getIpAccessMode();
  if (mode === "off") return { allowed: true, ipAddress, mode, trusted: true };

  const trusted = await isTrustedIp(ipAddress);
  if (trusted) return { allowed: true, ipAddress, mode, trusted };

  const emergencyBypass = Boolean(
    user && user.role === "admin" && (user.emergencyIpBypass || isEmergencyIpBypassEnabled()),
  );
  const allowed = mode === "notify" || emergencyBypass;
  const result = emergencyBypass ? "bypassed" : allowed ? "allowed" : "blocked";
  const reason = emergencyBypass
    ? "Emergency Admin IP bypass used from untrusted IP."
    : mode === "notify"
      ? "Login allowed from untrusted IP in notify-only mode."
      : "Login blocked because IP is not trusted.";
  await logIpLoginAttempt({
    ipAddress,
    username,
    user,
    mode,
    result,
    reason,
  });
  return { allowed, ipAddress, mode, trusted, reason };
}

export async function logIpLoginAttempt({
  ipAddress,
  username,
  user,
  mode,
  result,
  reason,
}: {
  ipAddress: string;
  username: string;
  user?: LoginIpUser;
  mode: IpAccessMode;
  result: "allowed" | "blocked" | "bypassed";
  reason: string;
}) {
  await ensureIpAccessControlSchema();
  await pool.query(
    `insert into ip_login_attempts
       (ip_address, username, user_id, user_name, user_role, mode, result, reason)
     values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      normalizeIpAddress(ipAddress) || "unknown",
      username,
      user?.id ?? null,
      user?.name ?? null,
      user?.role ?? null,
      mode,
      result,
      reason,
    ],
  );
}

export async function getIpAccessConfig(currentIp: string) {
  await ensureIpAccessControlSchema();
  const [settings, trustedIps, attempts, archivedAttempts, pendingCount] = await Promise.all([
    pool.query<IpAccessConfigRow>("select mode from ip_access_settings where id = true"),
    pool.query<TrustedIpRow>(
      `select id, ip_address, remarks, active, created_by_name, created_at, updated_at
       from trusted_ip_addresses
       order by active desc, ip_address asc`,
    ),
    pool.query<IpAttemptRow>(
      `select id, ip_address, username, user_id, user_name, user_role, mode, result, reason,
              attempted_at, archived_at, archived_by_name
       from ip_login_attempts
       where archived_at is null
       order by attempted_at desc
       limit 200`,
    ),
    pool.query<IpAttemptRow>(
      `select id, ip_address, username, user_id, user_name, user_role, mode, result, reason,
              attempted_at, archived_at, archived_by_name
       from ip_login_attempts
       where archived_at is not null
       order by archived_at desc, attempted_at desc
       limit 200`,
    ),
    pool.query<{ count: string }>(
      "select count(*)::text as count from ip_login_attempts where archived_at is null",
    ),
  ]);
  return {
    mode: settings.rows[0]?.mode ?? "off",
    currentIp: normalizeIpAddress(currentIp),
    trustedIps: trustedIps.rows.map(mapTrustedIp),
    attempts: attempts.rows.map(mapIpAttempt),
    archivedAttempts: archivedAttempts.rows.map(mapIpAttempt),
    pendingCount: Number(pendingCount.rows[0]?.count ?? 0),
    emergencyBypassEnv: isEmergencyIpBypassEnabled(),
  };
}

export async function updateIpAccessMode(
  mode: IpAccessMode,
  user: { id: string; name: string },
) {
  await ensureIpAccessControlSchema();
  await pool.query(
    `update ip_access_settings
     set mode = $1, updated_by_user_id = $2, updated_by_name = $3, updated_at = now()
     where id = true`,
    [mode, user.id, user.name],
  );
}

export async function addTrustedIp(
  ipAddress: string,
  remarks: string,
  user: { id: string; name: string },
) {
  await ensureIpAccessControlSchema();
  const normalized = normalizeIpAddress(ipAddress);
  if (!normalized) throw new Error("IP address is required.");
  await pool.query(
    `insert into trusted_ip_addresses
       (ip_address, remarks, active, created_by_user_id, created_by_name)
     values ($1, $2, true, $3, $4)
     on conflict (ip_address) do update
     set remarks = excluded.remarks,
         active = true,
         updated_at = now()`,
    [normalized, remarks.trim(), user.id, user.name],
  );
  await archiveAttemptsForIp(normalized, user, "Archived because IP was added to trusted list.");
}

export async function updateTrustedIp(
  id: string,
  patch: { remarks?: string; active?: boolean },
  user?: { id: string; name: string },
) {
  await ensureIpAccessControlSchema();
  const fields: string[] = [];
  const values: unknown[] = [];
  if (patch.remarks !== undefined) {
    values.push(patch.remarks.trim());
    fields.push(`remarks = $${values.length}`);
  }
  if (patch.active !== undefined) {
    values.push(patch.active);
    fields.push(`active = $${values.length}`);
  }
  if (!fields.length) return;
  values.push(id);
  await pool.query(
    `update trusted_ip_addresses set ${fields.join(", ")}, updated_at = now()
     where id = $${values.length}`,
    values,
  );
  if (patch.active === true && user) {
    const result = await pool.query<{ ip_address: string }>(
      "select ip_address from trusted_ip_addresses where id = $1",
      [id],
    );
    const ipAddress = result.rows[0]?.ip_address;
    if (ipAddress) {
      await archiveAttemptsForIp(ipAddress, user, "Archived because IP was marked trusted.");
    }
  }
}

export async function archiveIpAttempt(id: string, user: { id: string; name: string }) {
  await ensureIpAccessControlSchema();
  await pool.query(
    `update ip_login_attempts
     set archived_at = now(), archived_by_user_id = $2, archived_by_name = $3
     where id = $1 and archived_at is null`,
    [id, user.id, user.name],
  );
}

async function archiveAttemptsForIp(
  ipAddress: string,
  user: { id: string; name: string },
  reason: string,
) {
  await pool.query(
    `update ip_login_attempts
     set archived_at = now(), archived_by_user_id = $2, archived_by_name = $3, reason = $4
     where ip_address = $1 and archived_at is null`,
    [ipAddress, user.id, user.name, reason],
  );
}

function mapTrustedIp(row: TrustedIpRow) {
  return {
    id: row.id,
    ipAddress: row.ip_address,
    remarks: row.remarks ?? "",
    active: row.active,
    createdByName: row.created_by_name ?? undefined,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function mapIpAttempt(row: IpAttemptRow) {
  return {
    id: row.id,
    ipAddress: row.ip_address,
    username: row.username,
    userId: row.user_id ?? undefined,
    userName: row.user_name ?? undefined,
    userRole: row.user_role ?? undefined,
    mode: row.mode,
    result: row.result,
    reason: row.reason,
    attemptedAt: toIso(row.attempted_at),
    archivedAt: toIso(row.archived_at),
    archivedByName: row.archived_by_name ?? undefined,
  };
}

function toIso(value: Date | string | null | undefined) {
  if (!value) return undefined;
  return value instanceof Date ? value.toISOString() : String(value);
}
