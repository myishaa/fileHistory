import { raw, Router } from "express";
import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from "node:crypto";
import { constants as fsConstants, createReadStream, createWriteStream } from "node:fs";
import { promises as fs } from "node:fs";
import { spawn } from "node:child_process";
import { basename, dirname, isAbsolute, join } from "node:path";
import { pipeline } from "node:stream/promises";
import type { PoolClient } from "pg";
import { pool } from "../db/pool.js";
import type {
  AppSettings,
  AppFontFamily,
  AppFontScale,
  AppearancePreset,
  FinancialYearStatus,
  AppTheme,
  AppThemeTint,
  TopRibbonColor,
  TopRibbonTextColor,
  FirmRatingConfig,
  FileTypeGroupSetting,
  QuickEntryExcelPreset,
  SharedQuickAccessSettings,
  ValueThresholdAppliesTo,
  ValueThresholdLevel,
} from "../types.js";
import { requireAuth, type AuthRequest } from "../utils/auth.js";
import {
  cacheTtl,
  clearCachePrefix,
  clearDashboardReportCaches,
  getCached,
} from "../utils/cache.js";
import { fromDbJsonArray, fromDbText, toDbText } from "../utils/db-values.js";
import { normalizeFileTypeGroups } from "../utils/file-type-groups.js";
import { ensureFinancialYearArchiveSchema } from "../utils/financial-year-archive.js";
import {
  deletionPasswordIsConfigured,
  saveDeletionPassword,
  verifyDeletionPassword,
} from "../utils/deletion-password.js";
import {
  addTrustedIp,
  archiveIpAttempt,
  deleteArchivedIpAttempt,
  getIpAccessConfig,
  getRequestIp,
  type IpAccessMode,
  updateIpAccessMode,
  updateTrustedIp,
} from "../utils/ip-access-control.js";
import {
  asyncHandler,
  HttpError,
  requireObjectBody,
  requireParam,
  requireString,
} from "../utils/http.js";

export const settingsRouter = Router();

const protectedBackupFormat = "recordkeeper-protected-backup";
const protectedBackupVersion = 1;
const protectedBackupSchemaVersion = 2;
const fullBackupFormat = "recordkeeper-full-recovery-backup";
const fullBackupVersion = 1;
let fullRecoveryRestoreInProgress = false;

type PublicTableSchema = {
  tableName: string;
  columns: string[];
};

type QueryRunner = (sql: string) => Promise<{ rows: Array<Record<string, unknown>> }>;

function quoteIdentifier(value: string) {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value)) {
    throw new HttpError(400, "Invalid backup table identifier.");
  }
  return `"${value}"`;
}

function encryptProtectedBackup(payload: unknown, password: string) {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = scryptSync(password, salt, 32);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  return {
    format: protectedBackupFormat,
    version: protectedBackupVersion,
    algorithm: "aes-256-gcm",
    kdf: "scrypt",
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: encrypted.toString("base64"),
  };
}

function decryptProtectedBackup(envelope: unknown, password: string) {
  if (!envelope || typeof envelope !== "object") throw new HttpError(400, "Invalid backup file.");
  const value = envelope as Record<string, unknown>;
  if (value.format !== protectedBackupFormat || value.version !== protectedBackupVersion) {
    throw new HttpError(400, "Unsupported or invalid backup version.");
  }
  const fields = ["salt", "iv", "tag", "data"];
  if (fields.some((field) => typeof value[field] !== "string")) {
    throw new HttpError(400, "Backup encryption metadata is incomplete.");
  }
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      scryptSync(password, Buffer.from(value.salt as string, "base64"), 32),
      Buffer.from(value.iv as string, "base64"),
    );
    decipher.setAuthTag(Buffer.from(value.tag as string, "base64"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(value.data as string, "base64")),
      decipher.final(),
    ]).toString("utf8");
    return JSON.parse(plaintext) as Record<string, unknown>;
  } catch {
    throw new HttpError(400, "Backup encryption password is incorrect or the file is damaged.");
  }
}

type BackupUser = { id: string; username: string };

async function buildProtectedBackupEnvelope(user: BackupUser, password: string) {
  // Keep the audit table inside the same protected backup as every other
  // application table. This also makes its identity sequence recoverable.
  await ensureProtectedBackupSchema();
  const schema = await readPublicTableSchema((sql) => pool.query(sql));

  const tables: Record<string, { columns: string[]; rows: unknown[][] }> = {};
  let rowCount = 0;
  for (const { tableName } of schema) {
    const columnsResult = await pool.query<{ column_name: string; data_type: string; udt_name: string }>(
      `select column_name
              , data_type
              , udt_name
       from information_schema.columns
       where table_schema = 'public' and table_name = $1
       order by ordinal_position`,
      [tableName],
    );
    const columns = columnsResult.rows.map((row) => row.column_name);
    const dateColumns = new Set(
      columnsResult.rows
        .filter((row) => row.data_type === "date")
        .map((row) => row.column_name),
    );
    const selectList = columns
      .map((column) =>
        dateColumns.has(column)
          ? `${quoteIdentifier(column)}::text as ${quoteIdentifier(column)}`
          : quoteIdentifier(column),
      )
      .join(", ");
    const rowsResult = await pool.query<Record<string, unknown>>(
      `select ${selectList} from ${quoteIdentifier(tableName)}`,
    );
    const rows = rowsResult.rows.map((row) => columns.map((column) => row[column] ?? null));
    tables[tableName] = { columns, rows };
    rowCount += rows.length;
  }
  const createdAt = new Date().toISOString();
  const envelope = encryptProtectedBackup({
    format: protectedBackupFormat,
    version: protectedBackupVersion,
    schemaVersion: protectedBackupSchemaVersion,
    schema: {
      tables: schema.map((table) => ({ name: table.tableName, columns: table.columns })),
      fingerprint: schemaFingerprint(schema),
    },
    createdAt,
    createdBy: user.username,
    tables,
  }, password);
  return { envelope, schema, rowCount, createdAt };
}

async function runBackupCommand(
  command: string,
  args: string[],
  label: string,
  stdoutPath?: string,
) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      env: process.env,
      stdio: ["ignore", stdoutPath ? "pipe" : "ignore", "pipe"],
    });
    const stderr: Buffer[] = [];
    let output: ReturnType<typeof createWriteStream> | undefined;
    let outputFinished = !stdoutPath;
    let exitCode: number | null = null;
    let settled = false;
    if (stdoutPath && child.stdout) {
      output = createWriteStream(stdoutPath, { mode: 0o600 });
      output.once("finish", () => {
        outputFinished = true;
        finish();
      });
      output.once("error", (error) => fail(error));
      child.stdout.pipe(output);
    }
    child.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.once("error", (error) => fail(error));
    child.once("close", (code) => {
      exitCode = code;
      finish();
    });

    function finish() {
      if (settled || exitCode === null || !outputFinished) return;
      if (exitCode === 0) {
        settled = true;
        resolve();
      } else {
        fail(new Error(`${label} failed${stderr.length ? `: ${Buffer.concat(stderr).toString("utf8").trim()}` : "."}`));
      }
    }
    function fail(error: unknown) {
      if (settled) return;
      settled = true;
      reject(new HttpError(503, error instanceof Error ? error.message : `${label} failed.`));
    }
  });
}

async function sha256File(filePath: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

async function encryptRecoveryArchive(
  archivePath: string,
  outputPath: string,
  password: string,
  metadata: Record<string, unknown>,
) {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = scryptSync(password, salt, 32);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const header = Buffer.from(JSON.stringify({
    format: fullBackupFormat,
    version: fullBackupVersion,
    algorithm: "aes-256-gcm",
    kdf: "scrypt",
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
    metadata,
  }) + "\n", "utf8");
  await fs.writeFile(outputPath, header, { mode: 0o600 });
  await pipeline(
    createReadStream(archivePath),
    cipher,
    createWriteStream(outputPath, { flags: "a", mode: 0o600 }),
  );
  await fs.appendFile(outputPath, cipher.getAuthTag());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function packageRelativePath(packageRoot: string, value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim() || isAbsolute(value)) {
    throw new HttpError(400, `Recovery package ${label} path is invalid.`);
  }
  const resolved = join(packageRoot, value);
  if (dirname(resolved) !== packageRoot && !resolved.startsWith(`${packageRoot}/`)) {
    throw new HttpError(400, `Recovery package ${label} path is invalid.`);
  }
  return resolved;
}

async function decryptRecoveryPackage(
  encryptedPath: string,
  archivePath: string,
  password: string,
) {
  const encrypted = await fs.readFile(encryptedPath);
  const headerEnd = encrypted.indexOf(0x0a);
  if (headerEnd < 0) throw new HttpError(400, "Recovery package header is missing.");
  let header: Record<string, unknown>;
  try {
    const parsed = JSON.parse(encrypted.subarray(0, headerEnd).toString("utf8"));
    if (!isRecord(parsed)) throw new Error("header is not an object");
    header = parsed;
  } catch {
    throw new HttpError(400, "Recovery package header is invalid.");
  }
  if (header.format !== fullBackupFormat || header.version !== fullBackupVersion) {
    throw new HttpError(400, "Unsupported recovery package format.");
  }
  if (typeof header.salt !== "string" || typeof header.iv !== "string") {
    throw new HttpError(400, "Recovery package encryption metadata is incomplete.");
  }
  const tagLength = 16;
  if (encrypted.length <= headerEnd + 1 + tagLength) {
    throw new HttpError(400, "Recovery package is empty.");
  }
  const ciphertext = encrypted.subarray(headerEnd + 1, encrypted.length - tagLength);
  const tag = encrypted.subarray(encrypted.length - tagLength);
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      scryptSync(password, Buffer.from(header.salt, "base64"), 32),
      Buffer.from(header.iv, "base64"),
    );
    decipher.setAuthTag(tag);
    const archive = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    await fs.writeFile(archivePath, archive, { mode: 0o600 });
  } catch {
    throw new HttpError(400, "Recovery PIN is incorrect or the package is damaged.");
  }
}

async function validateRecoveryPackage(packageRoot: string) {
  const manifestPath = join(packageRoot, "manifest.json");
  let manifest: Record<string, unknown>;
  try {
    const parsed = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    if (!isRecord(parsed)) throw new Error("manifest is not an object");
    manifest = parsed;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, "Recovery package manifest is missing or invalid.");
  }
  if (manifest.format !== fullBackupFormat || manifest.version !== fullBackupVersion) {
    throw new HttpError(400, "Unsupported recovery package manifest.");
  }
  const checksums = manifest.checksums;
  if (!isRecord(checksums)) throw new HttpError(400, "Recovery package checksums are missing.");
  for (const [fileName, expected] of Object.entries(checksums)) {
    const filePath = packageRelativePath(packageRoot, fileName, "checksum");
    if (typeof expected !== "string" || !/^[a-f0-9]{64}$/i.test(expected)) {
      throw new HttpError(400, `Recovery package checksum for ${fileName} is invalid.`);
    }
    const actual = await sha256File(filePath).catch(() => null);
    if (!actual || actual.toLowerCase() !== expected.toLowerCase()) {
      throw new HttpError(400, `Recovery package checksum failed for ${fileName}.`);
    }
  }
  const requiredFields = ["databaseDump", "postgresGlobals", "applicationBackup"] as const;
  for (const field of requiredFields) {
    const filePath = packageRelativePath(packageRoot, manifest[field], field);
    const stat = await fs.stat(filePath).catch(() => undefined);
    if (!stat?.isFile()) throw new HttpError(400, `Recovery package ${field} is missing.`);
  }
  return manifest;
}

async function restoreConfiguredExternalStorage(
  packageRoot: string,
  manifest: Record<string, unknown>,
) {
  const archiveReference = manifest.externalStorage;
  if (!archiveReference) {
    return { restored: false, warning: null as string | null };
  }
  const externalStorageDir = process.env.EXTERNAL_STORAGE_DIR?.trim();
  if (!externalStorageDir) {
    return {
      restored: false,
      warning: "The package contains external storage, but EXTERNAL_STORAGE_DIR is not configured on this server.",
    };
  }
  const archivePath = packageRelativePath(packageRoot, archiveReference, "external storage");
  const archiveStat = await fs.stat(archivePath).catch(() => undefined);
  if (!archiveStat?.isFile()) throw new HttpError(400, "Recovery package external storage archive is missing.");
  const targetName = basename(externalStorageDir);
  const targetParent = dirname(externalStorageDir);
  if (!targetName || targetName === "." || externalStorageDir === "/") {
    throw new HttpError(503, "EXTERNAL_STORAGE_DIR is not a safe restore directory.");
  }
  await fs.mkdir(targetParent, { recursive: true });
  const stagingRoot = join(targetParent, `.${targetName}.restore-${randomBytes(6).toString("hex")}`);
  const rollbackPath = join(targetParent, `.${targetName}.previous-${randomBytes(6).toString("hex")}`);
  let movedCurrent = false;
  try {
    await fs.mkdir(stagingRoot, { recursive: true, mode: 0o700 });
    await runBackupCommand(
      process.env.TAR_PATH?.trim() || "tar",
      ["-xzf", archivePath, "--no-absolute-names", "--no-same-owner", "-C", stagingRoot],
      "External storage restore",
    );
    const stagedStorage = join(stagingRoot, targetName);
    const stagedStat = await fs.stat(stagedStorage).catch(() => undefined);
    if (!stagedStat?.isDirectory()) {
      throw new HttpError(400, "Recovery package external storage archive has an unexpected directory.");
    }
    const currentStat = await fs.stat(externalStorageDir).catch(() => undefined);
    if (currentStat) {
      await fs.rename(externalStorageDir, rollbackPath);
      movedCurrent = true;
    }
    await fs.rename(stagedStorage, externalStorageDir);
    if (movedCurrent) await fs.rm(rollbackPath, { recursive: true, force: true });
    return { restored: true, warning: null as string | null };
  } catch (error) {
    if (movedCurrent) {
      await fs.rm(externalStorageDir, { recursive: true, force: true }).catch(() => undefined);
      await fs.rename(rollbackPath, externalStorageDir).catch(() => undefined);
    }
    throw error;
  } finally {
    await fs.rm(stagingRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function restoreConfiguredDeploymentFiles(
  packageRoot: string,
  manifest: Record<string, unknown>,
) {
  const warnings: string[] = [];
  const files = [
    {
      manifestField: "deploymentConfig",
      environmentField: "RECORDKEEPER_BACKUP_CONFIG_FILE",
      label: "deployment configuration",
    },
    {
      manifestField: "deploymentSecrets",
      environmentField: "RECORDKEEPER_BACKUP_SECRETS_FILE",
      label: "deployment secrets",
    },
  ] as const;

  for (const file of files) {
    const sourceReference = manifest[file.manifestField];
    if (!sourceReference) continue;
    const targetPath = process.env[file.environmentField]?.trim();
    if (!targetPath) {
      warnings.push(
        `The package contains ${file.label}, but ${file.environmentField} is not configured on this server.`,
      );
      continue;
    }
    if (!isAbsolute(targetPath)) {
      warnings.push(`${file.environmentField} must be an absolute path; ${file.label} was not restored.`);
      continue;
    }
    const sourcePath = packageRelativePath(packageRoot, sourceReference, file.label);
    const sourceStat = await fs.stat(sourcePath).catch(() => undefined);
    if (!sourceStat?.isFile()) throw new HttpError(400, `Recovery package ${file.label} is missing.`);
    const targetDirectory = dirname(targetPath);
    await fs.mkdir(targetDirectory, { recursive: true, mode: 0o700 });
    const stagedTarget = `${targetPath}.restore-${randomBytes(6).toString("hex")}`;
    try {
      await fs.copyFile(sourcePath, stagedTarget);
      await fs.chmod(stagedTarget, 0o600);
      await fs.rename(stagedTarget, targetPath);
    } finally {
      await fs.rm(stagedTarget, { force: true }).catch(() => undefined);
    }
  }
  return warnings;
}

async function readPublicTableSchema(query: QueryRunner): Promise<PublicTableSchema[]> {
  const result = await query(`
    select t.table_name, c.column_name
    from information_schema.tables t
    join information_schema.columns c
      on c.table_schema = t.table_schema and c.table_name = t.table_name
    where t.table_schema = 'public'
      and t.table_type = 'BASE TABLE'
      and t.table_name <> 'protected_backup_settings'
    order by t.table_name, c.ordinal_position
  `);
  const schema = new Map<string, string[]>();
  for (const row of result.rows) {
    const tableName = String(row.table_name);
    const columnName = String(row.column_name);
    const columns = schema.get(tableName) ?? [];
    columns.push(columnName);
    schema.set(tableName, columns);
  }
  return [...schema.entries()].map(([tableName, columns]) => ({ tableName, columns }));
}

function schemaFingerprint(schema: PublicTableSchema[]) {
  return createHash("sha256")
    .update(schema.map((table) => `${table.tableName}:${table.columns.join(",")}`).join("\n"))
    .digest("hex");
}

async function resetPublicSequences(client: PoolClient) {
  const sequences = await client.query<{
    schema_name: string;
    sequence_name: string;
    table_name: string;
    column_name: string;
  }>(`
    select c.table_schema as schema_name,
           pg_get_serial_sequence(format('%I.%I', c.table_schema, c.table_name), c.column_name) as sequence_name,
           c.table_name,
           c.column_name
    from information_schema.columns c
    where c.table_schema = 'public'
      and pg_get_serial_sequence(format('%I.%I', c.table_schema, c.table_name), c.column_name) is not null
    order by c.table_name, c.ordinal_position
  `);
  for (const sequence of sequences.rows) {
    const tableName = `${quoteIdentifier(sequence.schema_name)}.${quoteIdentifier(sequence.table_name)}`;
    const columnName = quoteIdentifier(sequence.column_name);
    const sequenceName = sequence.sequence_name;
    const maximum = await client.query<{ maximum: string | null }>(
      `select max(${columnName})::text as maximum from ${tableName}`,
    );
    const value = maximum.rows[0]?.maximum;
    await client.query(`select setval($1::regclass, $2::bigint, $3)`, [
      sequenceName,
      value ?? "1",
      value !== null && value !== undefined,
    ]);
  }
}

async function ensureProtectedBackupSchema() {
  await pool.query(`
    create table if not exists protected_backup_log (
      id bigserial primary key,
      created_at timestamptz not null default now(),
      created_by uuid references app_users(id) on delete set null,
      table_count integer not null default 0,
      row_count bigint not null default 0
    )
  `);
}

let protectedBackupAuthorizationSchemaReady: Promise<void> | undefined;

function ensureProtectedBackupAuthorizationSchema() {
  protectedBackupAuthorizationSchemaReady ??= pool
    .query(`
      create table if not exists protected_backup_settings (
        id boolean primary key default true check (id),
        restore_authorization_password_hash text not null default '',
        restore_authorization_recovery_pin_hash text not null default '',
        updated_at timestamptz not null default now()
      );
      alter table protected_backup_settings
        add column if not exists restore_authorization_recovery_pin_hash text not null default '';
      insert into protected_backup_settings (id)
      values (true)
      on conflict (id) do nothing;
    `)
    .then(() => undefined);
  return protectedBackupAuthorizationSchemaReady;
}

const maxRestoreAuthorizationPasswordLength = 128;
const minRestoreAuthorizationPasswordLength = 8;
const restoreAuthorizationRecoveryPinLength = 6;

function readRestoreAuthorizationPassword(value: unknown, fieldName: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new HttpError(400, `${fieldName} is required.`);
  }
  if (value.length < minRestoreAuthorizationPasswordLength) {
    throw new HttpError(
      400,
      `${fieldName} must be at least ${minRestoreAuthorizationPasswordLength} characters.`,
    );
  }
  if (value.length > maxRestoreAuthorizationPasswordLength) {
    throw new HttpError(
      400,
      `${fieldName} must be ${maxRestoreAuthorizationPasswordLength} characters or fewer.`,
    );
  }
  return value;
}

function readRestoreAuthorizationRecoveryPin(value: unknown, fieldName: string) {
  if (typeof value !== "string" || !/^\d{6}$/.test(value)) {
    throw new HttpError(
      400,
      `${fieldName} must be exactly ${restoreAuthorizationRecoveryPinLength} numeric digits.`,
    );
  }
  return value;
}

async function saveRestoreAuthorizationPassword(
  currentPasswordValue: unknown,
  passwordValue: unknown,
  confirmationValue: unknown,
  recoveryPinValue: unknown,
  recoveryPinConfirmationValue: unknown,
) {
  const passwordDraftProvided =
    (typeof passwordValue === "string" && passwordValue.length > 0) ||
    (typeof confirmationValue === "string" && confirmationValue.length > 0);
  const recoveryPin = readRestoreAuthorizationRecoveryPin(
    recoveryPinValue,
    "Upload password Recovery PIN",
  );
  const recoveryPinConfirmation = readRestoreAuthorizationRecoveryPin(
    recoveryPinConfirmationValue,
    "Confirm Upload password Recovery PIN",
  );
  if (recoveryPin !== recoveryPinConfirmation) {
    throw new HttpError(400, "Upload password Recovery PINs do not match.");
  }
  await ensureProtectedBackupAuthorizationSchema();
  const existing = await pool.query<{ password_hash: string }>(
    `select restore_authorization_password_hash as password_hash
     from protected_backup_settings
     where id = true`,
  );
  const currentHash = existing.rows[0]?.password_hash ?? "";
  if (currentHash) {
    const currentPassword = readRestoreAuthorizationPassword(
      currentPasswordValue,
      "Current Upload password",
    );
    const verification = await pool.query<{ valid: boolean }>(
      `select $1 = crypt($2, $1) as valid`,
      [currentHash, currentPassword],
    );
    if (!verification.rows[0]?.valid) {
      throw new HttpError(403, "Current Upload password is incorrect.");
    }
  } else if (!passwordDraftProvided) {
    throw new HttpError(400, "Set an Upload password before saving the Recovery PIN.");
  }

  let password: string | undefined;
  if (passwordDraftProvided) {
    password = readRestoreAuthorizationPassword(passwordValue, "Upload password");
    const confirmation = readRestoreAuthorizationPassword(
      confirmationValue,
      "Confirm Upload password",
    );
    if (password !== confirmation) {
      throw new HttpError(400, "Upload passwords do not match.");
    }
  }
  if (password) {
    await setRestoreAuthorizationCredentials(password, recoveryPin);
  } else {
    await pool.query(
      `update protected_backup_settings
       set restore_authorization_recovery_pin_hash = crypt($1, gen_salt('bf')), updated_at = now()
       where id = true`,
      [recoveryPin],
    );
  }
}

async function setRestoreAuthorizationCredentials(password: string, recoveryPin: string) {
  await pool.query(
    `update protected_backup_settings
     set restore_authorization_password_hash = crypt($1, gen_salt('bf')),
         restore_authorization_recovery_pin_hash = crypt($2, gen_salt('bf')),
         updated_at = now()
     where id = true`,
    [password, recoveryPin],
  );
}

async function restoreAuthorizationPasswordIsConfigured() {
  await ensureProtectedBackupAuthorizationSchema();
  const result = await pool.query<{ configured: boolean }>(
    `select restore_authorization_password_hash <> '' as configured
     from protected_backup_settings
     where id = true`,
  );
  return result.rows[0]?.configured ?? false;
}

async function restoreAuthorizationRecoveryPinIsConfigured() {
  await ensureProtectedBackupAuthorizationSchema();
  const result = await pool.query<{ configured: boolean }>(
    `select restore_authorization_recovery_pin_hash <> '' as configured
     from protected_backup_settings
     where id = true`,
  );
  return result.rows[0]?.configured ?? false;
}

async function verifyRestoreAuthorizationPassword(passwordValue: unknown) {
  const password = readRestoreAuthorizationPassword(
    passwordValue,
    "Upload password",
  );
  await ensureProtectedBackupAuthorizationSchema();
  const result = await pool.query<{ configured: boolean; valid: boolean }>(
    `select
       restore_authorization_password_hash <> '' as configured,
       restore_authorization_password_hash <> ''
         and restore_authorization_password_hash = crypt($1, restore_authorization_password_hash) as valid
     from protected_backup_settings
     where id = true`,
    [password],
  );
  if (!result.rows[0]?.configured) {
    throw new HttpError(
      400,
      "Set an Upload password in Protected Backup settings before restoring.",
    );
  }
  if (!result.rows[0].valid) {
    throw new HttpError(403, "Incorrect Upload password.");
  }
}

type BackupRunType = "local" | "full_recovery" | "server_scheduled";
type BackupRunStatus = "running" | "success" | "failed";

type BackupRunRow = {
  id: string;
  backup_type: BackupRunType;
  status: BackupRunStatus;
  started_at: Date;
  completed_at: Date | null;
  file_name: string | null;
  error_message: string | null;
  table_count: number | null;
  row_count: string | null;
  external_storage_included: boolean;
  deployment_config_included: boolean;
  deployment_secrets_included: boolean;
};

let backupRunLogSchemaReady: Promise<void> | undefined;

function ensureBackupRunLogSchema() {
  backupRunLogSchemaReady ??= pool
    .query(`
      create table if not exists backup_run_log (
        id bigserial primary key,
        backup_type text not null check (backup_type in ('local', 'full_recovery', 'server_scheduled')),
        status text not null check (status in ('running', 'success', 'failed')),
        started_at timestamptz not null default now(),
        completed_at timestamptz,
        created_by uuid references app_users(id) on delete set null,
        file_name text,
        error_message text,
        table_count integer,
        row_count bigint,
        external_storage_included boolean not null default false,
        deployment_config_included boolean not null default false,
        deployment_secrets_included boolean not null default false
      );
      create index if not exists backup_run_log_type_started_idx
        on backup_run_log (backup_type, started_at desc)
    `)
    .then(() => undefined);
  return backupRunLogSchemaReady;
}

async function beginBackupRun(backupType: BackupRunType, userId: string | null) {
  await ensureBackupRunLogSchema();
  const result = await pool.query<{ id: string }>(
    `insert into backup_run_log (backup_type, status, created_by)
     values ($1, 'running', $2)
     returning id`,
    [backupType, userId],
  );
  return result.rows[0].id;
}

async function finishBackupRun(
  id: string,
  status: BackupRunStatus,
  details: {
    fileName?: string | null;
    errorMessage?: string | null;
    tableCount?: number | null;
    rowCount?: number | string | null;
    externalStorageIncluded?: boolean;
    deploymentConfigIncluded?: boolean;
    deploymentSecretsIncluded?: boolean;
  } = {},
) {
  await pool.query(
    `update backup_run_log
     set status = $2,
         completed_at = now(),
         file_name = $3,
         error_message = $4,
         table_count = $5,
         row_count = $6,
         external_storage_included = coalesce($7, external_storage_included),
         deployment_config_included = coalesce($8, deployment_config_included),
         deployment_secrets_included = coalesce($9, deployment_secrets_included)
     where id = $1`,
    [
      id,
      status,
      details.fileName ?? null,
      details.errorMessage?.slice(0, 2000) ?? null,
      details.tableCount ?? null,
      details.rowCount ?? null,
      details.externalStorageIncluded ?? null,
      details.deploymentConfigIncluded ?? null,
      details.deploymentSecretsIncluded ?? null,
    ],
  );
}

async function inspectDeploymentSecrets() {
  const filePath = process.env.RECORDKEEPER_BACKUP_SECRETS_FILE?.trim();
  if (!filePath) {
    return { configured: false, readable: false, error: "Secret file path is not configured." };
  }
  const fileStat = await fs.stat(filePath).catch(() => undefined);
  if (!fileStat?.isFile()) {
    return { configured: true, readable: false, error: "Configured secret file does not exist or is not a file." };
  }
  try {
    await fs.access(filePath, fsConstants.R_OK);
    return { configured: true, readable: true, error: null };
  } catch {
    return { configured: true, readable: false, error: "Configured secret file is not readable by the backend service." };
  }
}

const themes = new Set<AppTheme>(["light", "dark"]);
const themeTints = new Set<AppThemeTint>(["plain", "yellow", "green", "blue", "pink", "lavender"]);
const topRibbonColors = new Set<TopRibbonColor>([
  "navy",
  "teal",
  "charcoal",
  "maroon",
  "indigo",
  "gold",
  "warmGold",
  "black",
]);
const topRibbonTextColors = new Set<TopRibbonTextColor>([
  "white",
  "softWhite",
  "gold",
  "black",
  "brickRed",
]);
const appearancePresets = new Set<AppearancePreset>([
  "ocean",
  "forest",
  "graphite",
  "plum",
  "arcticGlass",
  "sageModern",
  "sunsetEditorial",
  "roseQuartz",
  "midnightIndigo",
]);
const appFontFamilies = new Set<AppFontFamily>(["inter", "manrope", "sourceSans", "nunito"]);
const appFontScales = new Set<AppFontScale>([90, 100, 110, 125, 140, 150, 160]);
const defaultChartColorOrder = [
  "#0f766e",
  "#2563eb",
  "#d97706",
  "#be123c",
  "#7c3aed",
  "#65a30d",
  "#0891b2",
  "#475569",
  "#e11d48",
  "#ea580c",
  "#4f46e5",
  "#16a34a",
  "#9333ea",
  "#0284c7",
  "#a16207",
  "#0d9488",
  "#c026d3",
  "#dc2626",
  "#84cc16",
  "#0369a1",
  "#b45309",
  "#7e22ce",
  "#15803d",
  "#be185d",
  "#64748b",
];
const chartBarColors = new Set(defaultChartColorOrder);
const defaultChartBarColor = "#0f766e";
const valueThresholdAppliesTo = new Set<ValueThresholdAppliesTo>(["capital", "revenue", "both"]);
const globalValueThresholdYear = "__global__";
const allFilesYear = "__all_files__";
const allActiveFilesYear = "__all_active_files__";
const activePlusCurrentFyClosedYear = "__active_plus_current_fy_closed__";
const ipAccessModes = new Set<IpAccessMode>(["off", "notify", "restrict"]);
const defaultAddEditRibbonFields = ["imms", "indentor"];
const allowedAddEditRibbonFields = new Set([
  "imms",
  "indentor",
  "year",
  "uniqueCode",
  "division",
  "fileTypeGroup",
  "mode",
  "demandValue",
  "valueCapital",
  "valueRevenue",
  "latestSupplyOrderNo",
  "latestFirmName",
]);

type SettingsRow = {
  financial_year: string;
  selected_year: string;
  setup_year: string | null;
  year_selection_locked: boolean;
  theme: AppTheme;
  theme_tint: AppThemeTint;
  global_chart_color_order: unknown;
  global_chart_colors_enforced: boolean;
  tcec_committees: unknown;
  firm_types: unknown;
  file_types: unknown;
  file_type_groups: unknown;
  modes: unknown;
  gem_bidding_modes: unknown;
  milestones: unknown;
  table_field_presets: unknown;
  mmg_live_enabled: boolean;
  mmg_live_options: unknown;
  mmg_summary_fields: unknown;
  demand_processing_presets: unknown;
  demand_processing_day_ranges: unknown;
  bg_receipt_delay_days: unknown;
  special_file_markers: unknown;
  firm_unique_no_label: string;
  firm_rating_config: unknown;
  active_user_id: string | null;
  pre_so_default_so_offset_days: number;
  pre_so_default_payment_offset_days: number;
  bg_return_offset_days: number;
  delay_status_default_days: number;
  shared_quick_access: unknown;
  quick_entry_excel_presets: unknown;
  quick_entry_excel_presets_legacy_imported: boolean;
};

type UserUiPreferencesRow = {
  theme: AppTheme | null;
  theme_tint: AppThemeTint | null;
  appearance_preset: AppearancePreset | null;
  font_family: AppFontFamily | null;
  font_scale: AppFontScale | null;
  top_ribbon_color: TopRibbonColor | null;
  top_ribbon_text_color: TopRibbonTextColor | null;
  chart_bar_color: string | null;
  chart_color_order: unknown;
  add_edit_ribbon_fields: unknown;
};

const defaultFirmRatingConfig: FirmRatingConfig = {
  fields: [
    { id: "delivery", label: "Delivery", weight: "1", minValue: "0", maxValue: "5" },
    { id: "quality", label: "Quality", weight: "1", minValue: "0", maxValue: "5" },
    {
      id: "afterSalesService",
      label: "After Sales Service",
      weight: "1",
      minValue: "0",
      maxValue: "5",
    },
  ],
};

function tagPresets(value: unknown, owner: "global" | "personal", ownerUserId?: string) {
  return fromDbJsonArray(value).map((preset) =>
    preset && typeof preset === "object"
      ? {
          ...(preset as Record<string, unknown>),
          owner,
          ...(ownerUserId ? { ownerUserId } : {}),
        }
      : preset,
  );
}

function presetOwnerKey(user: AuthRequest["authUser"]) {
  return user?.id;
}

function isStoredAppUser(user: AuthRequest["authUser"]) {
  return Boolean(user?.id && !user.id.startsWith("viewer:"));
}

function normalizeYearLabel(value: unknown, field = "financialYear") {
  const label = requireString(value, field).trim();
  if (!label) throw new HttpError(400, `${field} is required.`);
  if (
    label !== allFilesYear &&
    label !== allActiveFilesYear &&
    label !== activePlusCurrentFyClosedYear &&
    normalizeFinancialYearKey(label) === undefined
  ) {
    throw new HttpError(400, `${field} must be a valid financial year like 2026-27.`);
  }
  return label;
}

function readFinancialYearStatuses(value: unknown): FinancialYearStatus[] {
  if (!Array.isArray(value)) {
    throw new HttpError(400, "financialYearStatuses must be an array.");
  }
  const seen = new Set<string>();
  return value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new HttpError(400, `Financial year status ${index + 1} must be an object.`);
    }
    const candidate = item as Record<string, unknown>;
    const label = normalizeYearLabel(candidate.label, `financialYearStatuses[${index}].label`);
    if (seen.has(label)) {
      throw new HttpError(400, `Financial year ${label} appears more than once.`);
    }
    seen.add(label);
    if (typeof candidate.archived !== "boolean") {
      throw new HttpError(400, `financialYearStatuses[${index}].archived must be true or false.`);
    }
    return { label, archived: candidate.archived };
  });
}

function readAddEditRibbonFields(value: unknown) {
  if (!Array.isArray(value)) {
    throw new HttpError(400, "addEditRibbonFields must be an array.");
  }
  const unique = readAddEditRibbonFieldCandidates(value);
  if (unique.length !== 2) {
    throw new HttpError(400, "Select two valid Add/Edit ribbon fields.");
  }
  return unique;
}

function normalizeSharedQuickAccess(value: unknown): SharedQuickAccessSettings {
  const source =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const readIds = (candidate: unknown) =>
    Array.isArray(candidate)
      ? [
          ...new Set(
            candidate.filter(
              (id): id is string => typeof id === "string" && /^[a-zA-Z0-9-]+$/.test(id),
            ),
          ),
        ]
      : [];
  const interval = Number(source.noticeBoardIntervalSeconds);
  const readTransitionDuration = (key: string, fallback: number) => {
    const duration = Number(source[key]);
    return Number.isInteger(duration) && duration >= 100 && duration <= 30000 ? duration : fallback;
  };
  return {
    initialized: source.initialized === true,
    favorites: readIds(source.favorites),
    noticeBoardItems: readIds(source.noticeBoardItems),
    noticeBoardIntervalSeconds: Number.isInteger(interval)
      ? Math.min(120, Math.max(5, interval))
      : 15,
    noticeBoardSlideDurationMs: readTransitionDuration("noticeBoardSlideDurationMs", 1200),
    noticeBoardFadeOutDurationMs: readTransitionDuration("noticeBoardFadeOutDurationMs", 1400),
    noticeBoardFadeInDurationMs: readTransitionDuration("noticeBoardFadeInDurationMs", 900),
    noticeBoardVerticalScrollDurationMs: readTransitionDuration(
      "noticeBoardVerticalScrollDurationMs",
      2800,
    ),
  };
}

function readSharedQuickAccess(value: unknown): SharedQuickAccessSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, "sharedQuickAccess must be an object.");
  }
  const source = value as Record<string, unknown>;
  if (!Array.isArray(source.favorites) || !Array.isArray(source.noticeBoardItems)) {
    throw new HttpError(400, "Shared shortcut and Notice Board selections must be lists.");
  }
  const interval = Number(source.noticeBoardIntervalSeconds);
  if (!Number.isInteger(interval) || interval < 5 || interval > 120) {
    throw new HttpError(400, "Notice Board rotation must be between 5 and 120 seconds.");
  }
  for (const key of [
    "noticeBoardSlideDurationMs",
    "noticeBoardFadeOutDurationMs",
    "noticeBoardFadeInDurationMs",
    "noticeBoardVerticalScrollDurationMs",
  ]) {
    if (source[key] === undefined) continue;
    const duration = Number(source[key]);
    if (!Number.isInteger(duration) || duration < 100 || duration > 30000) {
      throw new HttpError(
        400,
        "Notice Board transition durations must be between 0.1 and 30 seconds.",
      );
    }
  }
  const normalized = normalizeSharedQuickAccess(source);
  return { ...normalized, initialized: true, noticeBoardIntervalSeconds: interval };
}

function readQuickEntryExcelPresets(value: unknown): QuickEntryExcelPreset[] {
  if (!Array.isArray(value)) throw new HttpError(400, "quickEntryExcelPresets must be a list.");
  if (value.length > 100) throw new HttpError(400, "At most 100 Excel exports can be configured.");

  const ids = new Set<string>();
  const names = new Set<string>();
  return value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new HttpError(400, `Excel export ${index + 1} is invalid.`);
    }
    const source = item as Record<string, unknown>;
    const id = typeof source.id === "string" ? source.id.trim() : "";
    const name = typeof source.name === "string" ? source.name.trim() : "";
    if (!id || id.length > 100 || !name || name.length > 120) {
      throw new HttpError(400, `Excel export ${index + 1} needs a valid ID and name.`);
    }
    const nameKey = name.toLowerCase();
    if (ids.has(id) || names.has(nameKey)) {
      throw new HttpError(400, "Excel export IDs and names must be unique.");
    }
    ids.add(id);
    names.add(nameKey);

    const fields = readStringArray(source.fields, `Excel export ${name} fields`);
    if (!fields.length) throw new HttpError(400, `${name} must include at least one field.`);
    const scopeMode = source.scopeMode ?? "fy";
    if (scopeMode !== "fy" && scopeMode !== "so") {
      throw new HttpError(400, `${name} has an invalid export scope.`);
    }
    const financialYear =
      typeof source.financialYear === "string" ? source.financialYear.trim() : "";
    const note = typeof source.note === "string" ? source.note.trim() : "";
    if (note.length > 300) throw new HttpError(400, `${name} note cannot exceed 300 characters.`);

    return {
      id,
      name,
      fields,
      ...(note ? { note } : {}),
      fileTypes: readStringArray(source.fileTypes ?? [], `${name} file types`),
      scopeMode,
      ...(financialYear ? { financialYear } : {}),
    };
  });
}

function normalizeAddEditRibbonFields(value: unknown) {
  if (!Array.isArray(value)) return defaultAddEditRibbonFields;
  const unique = readAddEditRibbonFieldCandidates(value);
  return unique.length === 2 ? unique : defaultAddEditRibbonFields;
}

function readAddEditRibbonFieldCandidates(value: unknown[]) {
  const normalized = value.filter(
    (field): field is string => typeof field === "string" && allowedAddEditRibbonFields.has(field),
  );
  return Array.from(new Set(normalized)).slice(0, 2);
}

function isFinancialYearLabel(label: string) {
  return /^\d{4}-\d{2}$/.test(label.trim());
}

function readFinancialYearStart(label: string) {
  const match = label.trim().match(/^(\d{4})-(\d{2}|\d{4})$/);
  if (!match) return undefined;
  const startYear = Number.parseInt(match[1], 10);
  const endYear = Number.parseInt(match[2], 10);
  const expectedShortEnd = (startYear + 1) % 100;
  const actualShortEnd = match[2].length === 2 ? endYear : endYear % 100;
  return actualShortEnd === expectedShortEnd ? startYear : undefined;
}

function normalizeFinancialYearKey(label: string) {
  const startYear = readFinancialYearStart(label);
  return startYear === undefined ? undefined : startYear;
}

function isKnownFinancialYear(labels: string[], label: string) {
  const target = normalizeFinancialYearKey(label);
  return target !== undefined && labels.some((year) => normalizeFinancialYearKey(year) === target);
}

function validateContinuousFinancialYear(labels: string[], label: string) {
  const target = normalizeFinancialYearKey(label);
  if (target === undefined) {
    throw new HttpError(400, "Financial year must be a valid continuous year like 2026-27.");
  }

  const existingStarts = labels
    .map(normalizeFinancialYearKey)
    .filter((start): start is number => start !== undefined);

  if (existingStarts.includes(target)) {
    throw new HttpError(400, `Financial year ${label} already exists.`);
  }
  if (!existingStarts.length) return;

  const earliest = Math.min(...existingStarts);
  const latest = Math.max(...existingStarts);
  if (target !== earliest - 1 && target !== latest + 1) {
    const previousAllowed = `${earliest - 1}-${String(earliest % 100).padStart(2, "0")}`;
    const nextAllowed = `${latest + 1}-${String((latest + 2) % 100).padStart(2, "0")}`;
    throw new HttpError(
      400,
      `Financial years must be continuous. Add ${previousAllowed} or ${nextAllowed} next.`,
    );
  }
}

async function loadFinancialYears() {
  return getCached("lookup:financial-years", cacheTtl.lookupMs, async () => {
    const result = await pool.query<{ label: string }>(
      "select label from financial_years order by label desc",
    );
    return result.rows.map((row) => row.label).filter((label) => normalizeFinancialYearKey(label));
  });
}

async function loadFinancialYearStatuses(): Promise<FinancialYearStatus[]> {
  return getCached("lookup:financial-years:statuses", cacheTtl.lookupMs, async () => {
    await ensureFinancialYearArchiveSchema();
    const result = await pool.query<{ label: string; is_archived: boolean }>(
      "select label, is_archived from financial_years order by label desc",
    );
    return result.rows
      .filter((row) => normalizeFinancialYearKey(row.label) !== undefined)
      .map((row) => ({ label: row.label, archived: row.is_archived === true }));
  });
}

async function loadTcecCommittees(financialYear: string, fallback: unknown) {
  return getCached(`lookup:tcec-committees:${financialYear}`, cacheTtl.lookupMs, async () => {
    const result = await pool.query<{ name: string }>(
      `select name
       from tcec_committees
       where financial_year = $1
       order by sort_order asc, name asc`,
      [financialYear],
    );
    if (result.rows.length) return result.rows.map((row) => row.name);
    return fromDbJsonArray(fallback) as string[];
  });
}

async function loadValueThresholdLevels(): Promise<ValueThresholdLevel[]> {
  return getCached(
    `lookup:value-thresholds:${globalValueThresholdYear}`,
    cacheTtl.lookupMs,
    async () => {
      const result = await pool.query<{
        id: string;
        level_number: number;
        label: string;
        min_value: string | null;
        max_value: string | null;
        applies_to: ValueThresholdAppliesTo;
      }>(
        `select id, level_number, label, min_value, max_value, applies_to
       from value_threshold_levels
       where financial_year = $1
       order by level_number asc`,
        [globalValueThresholdYear],
      );
      return result.rows.map((row) => ({
        id: row.id,
        label: row.label,
        levelNumber: row.level_number,
        minValue: fromDbText(row.min_value) || undefined,
        maxValue: fromDbText(row.max_value) || undefined,
        appliesTo: row.applies_to,
      }));
    },
  );
}

async function ensureFinancialYear(label: string, client: PoolClient | typeof pool = pool) {
  const years = await loadFinancialYears();
  if (isKnownFinancialYear(years, label)) {
    return false;
  }
  if (!isKnownFinancialYear(years, label)) {
    if (!isFinancialYearLabel(label)) {
      throw new HttpError(
        400,
        "New financial year must be entered in YYYY-YY format, like 2026-27.",
      );
    }
    validateContinuousFinancialYear(years, label);
  }
  const result = await client.query<{ label: string }>(
    "insert into financial_years (label) values ($1) on conflict (label) do nothing returning label",
    [label],
  );
  return (result.rowCount ?? 0) > 0;
}

async function copyYearSettings(sourceYear: string, targetYear: string, client: PoolClient) {
  if (!sourceYear || !targetYear || sourceYear === targetYear) return;

  await client.query(
    `insert into division_year_allocations (
       division_id, financial_year, allocated_capital, allocated_revenue, active
     )
     select division_id, $2, allocated_capital, allocated_revenue, active
     from division_year_allocations
     where financial_year = $1
     on conflict (division_id, financial_year) do nothing`,
    [sourceYear, targetYear],
  );

  await client.query(
    `insert into division_year_allocations (
       division_id, financial_year, allocated_capital, allocated_revenue, active
     )
     select
       d.id,
       $2,
       coalesce(a.allocated_capital, d.allocated_capital),
       coalesce(a.allocated_revenue, d.allocated_revenue),
       coalesce(a.active, true)
     from divisions d
     left join division_year_allocations a
       on a.division_id = d.id and a.financial_year = $1
     where d.archived_at is null
     on conflict (division_id, financial_year) do nothing`,
    [sourceYear, targetYear],
  );

  await client.query(
    `insert into tcec_committees (financial_year, name, sort_order)
     select $2, name, sort_order
     from tcec_committees
     where financial_year = $1
     on conflict do nothing`,
    [sourceYear, targetYear],
  );
}

async function loadUserTableFieldPresets(ownerKey: string) {
  return getCached(`settings:user-presets:${ownerKey}`, cacheTtl.settingsMs, async () => {
    const result = await pool.query<{ presets: unknown }>(
      "select presets from user_table_field_presets where owner_key = $1",
      [ownerKey],
    );
    return result.rows[0]?.presets ?? [];
  });
}

async function ensureUserLiveStatusPreferencesTable() {
  await pool.query(
    `create table if not exists user_live_status_preferences (
       owner_key text primary key,
       field_keys jsonb not null default '[]'::jsonb,
       updated_at timestamptz not null default now()
     )`,
  );
}

async function ensureUserReportPreferencesTable() {
  await pool.query(
    `create table if not exists user_report_preferences (
       user_id uuid not null references app_users(id) on delete cascade,
       report_key text not null,
       preferences jsonb not null default '{}'::jsonb,
       updated_at timestamptz not null default now(),
       primary key (user_id, report_key)
     )`,
  );
}

async function ensureUserUiPreferencesTable() {
  await pool.query(
    `create table if not exists user_ui_preferences (
       user_id uuid primary key references app_users(id) on delete cascade,
       theme text check (theme in ('light', 'dark')),
       theme_tint text check (
         theme_tint in ('plain', 'yellow', 'green', 'blue', 'pink', 'lavender')
       ),
       appearance_preset text check (
         appearance_preset in ('ocean', 'forest', 'graphite', 'plum')
       ),
       font_family text check (
         font_family in ('inter', 'manrope', 'sourceSans', 'nunito')
       ),
       font_scale integer check (font_scale in (90, 100, 110, 125, 140, 150, 160)),
       top_ribbon_color text check (
         top_ribbon_color in ('navy', 'teal', 'charcoal', 'maroon', 'indigo', 'gold', 'warmGold', 'black')
       ),
       top_ribbon_text_color text check (
         top_ribbon_text_color in ('white', 'softWhite', 'gold', 'black', 'brickRed')
       ),
       chart_bar_color text,
       chart_color_order jsonb,
       add_edit_ribbon_fields jsonb,
       updated_at timestamptz not null default now()
     )`,
  );
  await pool.query(
    "alter table user_ui_preferences add column if not exists add_edit_ribbon_fields jsonb",
  );
  await pool.query("alter table user_ui_preferences add column if not exists chart_bar_color text");
  await pool.query(
    "alter table user_ui_preferences add column if not exists chart_color_order jsonb",
  );
  await pool.query(
    "alter table user_ui_preferences add column if not exists top_ribbon_color text",
  );
  await pool.query(
    "alter table user_ui_preferences add column if not exists top_ribbon_text_color text",
  );
  await pool.query(
    `do $$
     declare constraint_definition text;
     begin
       select pg_get_constraintdef(c.oid)
       into constraint_definition
       from pg_constraint c
       join pg_class t on t.oid = c.conrelid
       where t.relname = 'user_ui_preferences'
         and c.conname = 'user_ui_preferences_top_ribbon_color_check';
       if constraint_definition is null then
         alter table user_ui_preferences
           add constraint user_ui_preferences_top_ribbon_color_check
           check (top_ribbon_color in ('navy', 'teal', 'charcoal', 'maroon', 'indigo', 'gold', 'warmGold', 'black'));
       elsif position('warmGold' in constraint_definition) = 0 or position('black' in constraint_definition) = 0 then
         alter table user_ui_preferences
           drop constraint user_ui_preferences_top_ribbon_color_check;
         alter table user_ui_preferences
           add constraint user_ui_preferences_top_ribbon_color_check
           check (top_ribbon_color in ('navy', 'teal', 'charcoal', 'maroon', 'indigo', 'gold', 'warmGold', 'black'));
       end if;

       select pg_get_constraintdef(c.oid)
       into constraint_definition
       from pg_constraint c
       join pg_class t on t.oid = c.conrelid
       where t.relname = 'user_ui_preferences'
         and c.conname = 'user_ui_preferences_top_ribbon_text_color_check';
       if constraint_definition is null then
         alter table user_ui_preferences
           add constraint user_ui_preferences_top_ribbon_text_color_check
           check (top_ribbon_text_color in ('white', 'softWhite', 'gold', 'black', 'brickRed'));
       elsif position('brickRed' in constraint_definition) = 0 then
         alter table user_ui_preferences
           drop constraint user_ui_preferences_top_ribbon_text_color_check;
         alter table user_ui_preferences
           add constraint user_ui_preferences_top_ribbon_text_color_check
           check (top_ribbon_text_color in ('white', 'softWhite', 'gold', 'black', 'brickRed'));
       end if;
     end $$;`,
  );
  await pool.query(
    `do $$
     declare constraint_definition text;
     begin
       select pg_get_constraintdef(c.oid)
       into constraint_definition
       from pg_constraint c
       join pg_class t on t.oid = c.conrelid
       where t.relname = 'user_ui_preferences'
         and c.conname = 'user_ui_preferences_font_scale_check';
       if constraint_definition is null then
         alter table user_ui_preferences
           add constraint user_ui_preferences_font_scale_check
           check (font_scale in (90, 100, 110, 125, 140, 150, 160));
       elsif position('150' in constraint_definition) = 0 or position('160' in constraint_definition) = 0 then
         alter table user_ui_preferences
           drop constraint user_ui_preferences_font_scale_check;
         alter table user_ui_preferences
           add constraint user_ui_preferences_font_scale_check
           check (font_scale in (90, 100, 110, 125, 140, 150, 160));
       end if;
     end $$;`,
  );
  await pool.query(
    "alter table user_ui_preferences add column if not exists appearance_preset text",
  );
  await pool.query("alter table user_ui_preferences add column if not exists font_family text");
  await pool.query("alter table user_ui_preferences add column if not exists font_scale integer");
}

async function loadUserUiPreferences(userId: string) {
  await ensureUserUiPreferencesTable();
  return getCached(`settings:ui-preferences:${userId}`, cacheTtl.settingsMs, async () => {
    const result = await pool.query<UserUiPreferencesRow>(
      "select theme, theme_tint, appearance_preset, font_family, font_scale, top_ribbon_color, top_ribbon_text_color, chart_bar_color, chart_color_order, add_edit_ribbon_fields from user_ui_preferences where user_id = $1",
      [userId],
    );
    return result.rows[0];
  });
}

async function loadUserLiveStatusFields(ownerKey: string) {
  await ensureUserLiveStatusPreferencesTable();
  return getCached(`settings:live-status-fields:${ownerKey}`, cacheTtl.settingsMs, async () => {
    const result = await pool.query<{ field_keys: unknown }>(
      "select field_keys from user_live_status_preferences where owner_key = $1",
      [ownerKey],
    );
    if (!result.rows[0]) return undefined;
    return fromDbJsonArray(result.rows[0].field_keys).filter(
      (key): key is string => typeof key === "string",
    );
  });
}

async function loadUserReportPreferences(userId: string, reportKey: string) {
  await ensureUserReportPreferencesTable();
  const result = await pool.query<{ preferences: unknown }>(
    "select preferences from user_report_preferences where user_id = $1 and report_key = $2",
    [userId, reportKey],
  );
  return result.rows[0]?.preferences ?? {};
}

const noticeBoardPersonalDefaults = {
  intervalSeconds: 15,
  transitionEffect: "slide" as const,
  slideDurationMs: 1200,
  fadeOutDurationMs: 1400,
  fadeInDurationMs: 900,
  verticalScrollDurationMs: 2800,
};

function normalizeNoticeBoardPersonalPreferences(value: unknown) {
  const source =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const readInteger = (key: string, fallback: number, min: number, max: number) => {
    const candidate = Number(source[key]);
    return Number.isInteger(candidate) ? Math.min(max, Math.max(min, candidate)) : fallback;
  };
  const effect = source.transitionEffect;
  return {
    intervalSeconds: readInteger(
      "intervalSeconds",
      noticeBoardPersonalDefaults.intervalSeconds,
      5,
      120,
    ),
    transitionEffect:
      effect === "slide" || effect === "fade" || effect === "vertical-scroll" || effect === "none"
        ? effect
        : noticeBoardPersonalDefaults.transitionEffect,
    slideDurationMs: readInteger(
      "slideDurationMs",
      noticeBoardPersonalDefaults.slideDurationMs,
      100,
      30000,
    ),
    fadeOutDurationMs: readInteger(
      "fadeOutDurationMs",
      noticeBoardPersonalDefaults.fadeOutDurationMs,
      100,
      30000,
    ),
    fadeInDurationMs: readInteger(
      "fadeInDurationMs",
      noticeBoardPersonalDefaults.fadeInDurationMs,
      100,
      30000,
    ),
    verticalScrollDurationMs: readInteger(
      "verticalScrollDurationMs",
      noticeBoardPersonalDefaults.verticalScrollDurationMs,
      100,
      30000,
    ),
  };
}

async function mapSettings(row: SettingsRow, user?: AuthRequest["authUser"]): Promise<AppSettings> {
  const financialYears = await loadFinancialYears();
  const financialYearStatuses = await loadFinancialYearStatuses();
  const setupYear =
    row.setup_year &&
    row.setup_year !== allFilesYear &&
    row.setup_year !== allActiveFilesYear &&
    row.setup_year !== activePlusCurrentFyClosedYear
      ? row.setup_year
      : row.financial_year;
  const mergedFinancialYears = Array.from(
    new Set(
      [row.financial_year, row.selected_year, setupYear, ...financialYears]
        .filter(Boolean)
        .filter(
          (year) =>
            year !== allFilesYear &&
            year !== allActiveFilesYear &&
            year !== activePlusCurrentFyClosedYear,
        ),
    ),
  ).sort((a, b) => b.localeCompare(a));
  const globalPresets = tagPresets(row.table_field_presets, "global");
  const ownerKey = presetOwnerKey(user);
  const personalPresets =
    user && user.role !== "admin" && ownerKey
      ? tagPresets(await loadUserTableFieldPresets(ownerKey), "personal", ownerKey)
      : [];
  const liveStatusLockedFields = ownerKey ? await loadUserLiveStatusFields(ownerKey) : undefined;
  const uiPreferences = isStoredAppUser(user) ? await loadUserUiPreferences(user!.id) : undefined;
  const globalChartColorOrder = normalizeChartColorOrder(row.global_chart_color_order);
  const globalChartColorsEnforced = row.global_chart_colors_enforced === true;
  const personalChartColorOrder = normalizeChartColorOrder(
    uiPreferences?.chart_color_order,
    uiPreferences?.chart_bar_color ?? defaultChartBarColor,
  );
  return {
    financialYear: row.financial_year,
    selectedYear: row.selected_year,
    setupYear,
    financialYears: mergedFinancialYears,
    financialYearStatuses: mergedFinancialYears.map(
      (label) =>
        financialYearStatuses.find((status) => status.label === label) ?? {
          label,
          archived: false,
        },
    ),
    yearSelectionLocked: row.year_selection_locked,
    theme: uiPreferences?.theme ?? row.theme,
    themeTint: uiPreferences?.theme_tint ?? row.theme_tint,
    appearancePreset: uiPreferences?.appearance_preset ?? null,
    fontFamily: uiPreferences?.font_family ?? null,
    fontScale: uiPreferences?.font_scale ?? 100,
    topRibbonColor: uiPreferences?.top_ribbon_color ?? null,
    topRibbonTextColor: uiPreferences?.top_ribbon_text_color ?? null,
    chartBarColor:
      (globalChartColorsEnforced ? globalChartColorOrder : personalChartColorOrder)[0] ??
      defaultChartBarColor,
    chartColorOrder: globalChartColorsEnforced ? globalChartColorOrder : personalChartColorOrder,
    globalChartColorOrder,
    globalChartColorsEnforced,
    // Deletion passwords are account-specific credentials. Never return the
    // legacy shared plaintext value through any Settings-derived payload.
    deletionPassword: "",
    tcecCommittees: await loadTcecCommittees(setupYear, row.tcec_committees),
    firmTypes: fromDbJsonArray(row.firm_types).filter(
      (firmType): firmType is string => typeof firmType === "string",
    ),
    fileTypes: fromDbJsonArray(row.file_types).filter(
      (fileType): fileType is string => typeof fileType === "string",
    ),
    fileTypeGroups: normalizeFileTypeGroups(
      row.file_type_groups,
      fromDbJsonArray(row.file_types).filter(
        (fileType): fileType is string => typeof fileType === "string",
      ),
    ),
    modes: fromDbJsonArray(row.modes).filter((mode): mode is string => typeof mode === "string"),
    gemBiddingModes: normalizeGemBiddingModes(row.gem_bidding_modes),
    valueThresholdLevels: await loadValueThresholdLevels(),
    milestones: fromDbJsonArray(row.milestones) as string[],
    tableFieldPresets: [...globalPresets, ...personalPresets],
    mmgLiveEnabled: row.mmg_live_enabled,
    mmgLiveOptions: fromDbJsonArray(row.mmg_live_options).filter(
      (option): option is string => typeof option === "string",
    ),
    mmgSummaryFields: fromDbJsonArray(row.mmg_summary_fields).filter(
      (field) => field && typeof field === "object" && !Array.isArray(field),
    ),
    demandProcessingPresets: fromDbJsonArray(row.demand_processing_presets).filter(
      (preset) => preset && typeof preset === "object" && !Array.isArray(preset),
    ),
    demandProcessingDayRanges: fromDbJsonArray(row.demand_processing_day_ranges).filter(
      (range) => range && typeof range === "object" && !Array.isArray(range),
    ),
    bgReceiptDelayDays: normalizeBgReceiptDelayDays(fromDbJsonArray(row.bg_receipt_delay_days)),
    specialFileMarkers: normalizeSpecialFileMarkers(fromDbJsonArray(row.special_file_markers)),
    firmUniqueNoLabel: fromDbText(row.firm_unique_no_label) || "Firm Unique No.",
    firmRatingConfig: normalizeFirmRatingConfig(row.firm_rating_config),
    addEditRibbonFields: normalizeAddEditRibbonFields(uiPreferences?.add_edit_ribbon_fields),
    preSoDefaultSoOffsetDays: Number(row.pre_so_default_so_offset_days ?? 30),
    preSoDefaultPaymentOffsetDays: Number(row.pre_so_default_payment_offset_days ?? 30),
    bgReturnOffsetDays: Number(row.bg_return_offset_days ?? 60),
    delayStatusDefaultDays: Number(row.delay_status_default_days ?? 5),
    sharedQuickAccess: normalizeSharedQuickAccess(row.shared_quick_access),
    quickEntryExcelPresets: readQuickEntryExcelPresets(row.quick_entry_excel_presets),
    quickEntryExcelPresetsLegacyImported: row.quick_entry_excel_presets_legacy_imported === true,
    ...(liveStatusLockedFields !== undefined ? { liveStatusLockedFields } : {}),
    activeUserId: fromDbText(row.active_user_id) || undefined,
  };
}

async function replaceTcecCommittees(financialYear: string, committees: unknown[]) {
  await pool.query("delete from tcec_committees where financial_year = $1", [financialYear]);
  let sortOrder = 0;
  for (const committee of committees) {
    const name = toDbText(committee);
    if (!name) continue;
    await pool.query(
      `insert into tcec_committees (financial_year, name, sort_order)
       values ($1, $2, $3)
       on conflict do nothing`,
      [financialYear, name, sortOrder++],
    );
  }
}

function readOptionalAmount(value: unknown, field: string) {
  const text = toDbText(value);
  if (!text) return null;
  const parsed = Number(text.replace(/,/g, ""));
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new HttpError(400, `${field} must be a positive number.`);
  }
  return parsed.toFixed(2);
}

function readValueThresholdLevels(value: unknown) {
  if (!Array.isArray(value)) throw new HttpError(400, "valueThresholdLevels must be an array.");
  return value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new HttpError(400, "Each threshold level must be an object.");
    }
    const candidate = item as Record<string, unknown>;
    const levelNumber = Number(candidate.levelNumber ?? index + 1);
    if (!Number.isInteger(levelNumber) || levelNumber < 1) {
      throw new HttpError(400, "levelNumber must be a positive integer.");
    }
    const label = toDbText(candidate.label) || `Level ${levelNumber}`;
    const appliesTo =
      typeof candidate.appliesTo === "string" &&
      valueThresholdAppliesTo.has(candidate.appliesTo as ValueThresholdAppliesTo)
        ? (candidate.appliesTo as ValueThresholdAppliesTo)
        : "both";
    const minValue = readOptionalAmount(candidate.minValue, `${label} minimum value`);
    const maxValue = readOptionalAmount(candidate.maxValue, `${label} maximum value`);
    if (minValue !== null && maxValue !== null && Number(minValue) > Number(maxValue)) {
      throw new HttpError(400, `${label} minimum cannot be greater than maximum.`);
    }
    return { label, levelNumber, minValue, maxValue, appliesTo };
  });
}

async function replaceValueThresholdLevels(levels: unknown[]) {
  const normalized = readValueThresholdLevels(levels);
  await pool.query("delete from value_threshold_levels where financial_year = $1", [
    globalValueThresholdYear,
  ]);
  for (const level of normalized) {
    await pool.query(
      `insert into value_threshold_levels (
         financial_year, level_number, label, min_value, max_value, applies_to
       )
       values ($1, $2, $3, $4, $5, $6)`,
      [
        globalValueThresholdYear,
        level.levelNumber,
        level.label,
        level.minValue,
        level.maxValue,
        level.appliesTo,
      ],
    );
  }
}

async function getSettings(user?: AuthRequest["authUser"]) {
  const key = `settings:app:${user?.id ?? "anonymous"}:${user?.role ?? "none"}`;
  return getCached(key, cacheTtl.settingsMs, async () => {
    await ensurePreSoSettingsSchema();
    await ensureFinancialYearArchiveSchema();
    const result = await pool.query<SettingsRow>(
      `select financial_year, selected_year, coalesce(setup_year, financial_year) as setup_year, year_selection_locked, theme, theme_tint,
              global_chart_color_order, global_chart_colors_enforced,
              tcec_committees, firm_types, file_types, file_type_groups, modes, gem_bidding_modes, milestones, table_field_presets, mmg_live_enabled, mmg_live_options,
              mmg_summary_fields, demand_processing_presets, demand_processing_day_ranges,
              bg_receipt_delay_days, special_file_markers, firm_unique_no_label, firm_rating_config, active_user_id,
              pre_so_default_so_offset_days, pre_so_default_payment_offset_days, bg_return_offset_days,
              delay_status_default_days,
              shared_quick_access, quick_entry_excel_presets, quick_entry_excel_presets_legacy_imported
       from app_settings
       where id = true`,
    );
    if (!result.rows[0]) throw new HttpError(404, "Settings row not found. Run seed defaults.");
    return mapSettings(result.rows[0], user);
  });
}

let preSoSettingsSchemaReady: Promise<void> | undefined;

function ensurePreSoSettingsSchema() {
  preSoSettingsSchemaReady ??= pool
    .query(
      `alter table app_settings
         add column if not exists pre_so_default_so_offset_days integer not null default 30;
       alter table app_settings
         add column if not exists pre_so_default_payment_offset_days integer not null default 30;
       alter table app_settings
         add column if not exists bg_return_offset_days integer not null default 60;
       alter table app_settings
         add column if not exists delay_status_default_days integer not null default 5;
       alter table app_settings
         add column if not exists gem_bidding_modes jsonb not null default '["Custom", "Catalogue", "Comparison"]'::jsonb;
       alter table app_settings
         add column if not exists global_chart_color_order jsonb not null default '["#0f766e", "#2563eb", "#d97706", "#be123c", "#7c3aed", "#65a30d", "#0891b2", "#475569", "#e11d48", "#ea580c", "#4f46e5", "#16a34a", "#9333ea", "#0284c7", "#a16207", "#0d9488", "#c026d3", "#dc2626", "#84cc16", "#0369a1", "#b45309", "#7e22ce", "#15803d", "#be185d", "#64748b"]'::jsonb;
       alter table app_settings
         add column if not exists global_chart_colors_enforced boolean not null default false`,
    )
    .then(() => undefined);
  return preSoSettingsSchemaReady;
}

function clearSettingsCache() {
  clearCachePrefix("settings:");
  clearDashboardReportCaches();
  clearCachePrefix("divisions:");
  clearCachePrefix("lookup:financial-years");
  clearCachePrefix("lookup:selected-year");
  clearCachePrefix("lookup:tcec-committees:");
  clearCachePrefix("lookup:value-thresholds:");
}

function readTheme(value: unknown) {
  if (typeof value !== "string" || !themes.has(value as AppTheme)) {
    throw new HttpError(400, "theme must be light or dark.");
  }
  return value as AppTheme;
}

function readThemeTint(value: unknown) {
  if (typeof value !== "string" || !themeTints.has(value as AppThemeTint)) {
    throw new HttpError(400, "themeTint is invalid.");
  }
  return value as AppThemeTint;
}

function readTopRibbonColor(value: unknown) {
  if (typeof value !== "string" || !topRibbonColors.has(value as TopRibbonColor)) {
    throw new HttpError(400, "topRibbonColor is invalid.");
  }
  return value as TopRibbonColor;
}

function readOptionalTopRibbonColor(value: unknown) {
  if (value === null || value === "") return null;
  return readTopRibbonColor(value);
}

function readTopRibbonTextColor(value: unknown) {
  if (typeof value !== "string" || !topRibbonTextColors.has(value as TopRibbonTextColor)) {
    throw new HttpError(400, "topRibbonTextColor is invalid.");
  }
  return value as TopRibbonTextColor;
}

function readOptionalTopRibbonTextColor(value: unknown) {
  if (value === null || value === "") return null;
  return readTopRibbonTextColor(value);
}

function readAppearancePreset(value: unknown) {
  if (value === null || value === "") return null;
  if (typeof value !== "string" || !appearancePresets.has(value as AppearancePreset)) {
    throw new HttpError(400, "appearancePreset is invalid.");
  }
  return value as AppearancePreset;
}

function readFontFamily(value: unknown) {
  if (value === null || value === "") return null;
  if (typeof value !== "string" || !appFontFamilies.has(value as AppFontFamily)) {
    throw new HttpError(400, "fontFamily is invalid.");
  }
  return value as AppFontFamily;
}

function readFontScale(value: unknown) {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    !appFontScales.has(value as AppFontScale)
  ) {
    throw new HttpError(400, "fontScale is invalid.");
  }
  return value as AppFontScale;
}

function readChartBarColor(value: unknown) {
  if (typeof value !== "string" || !chartBarColors.has(value)) {
    throw new HttpError(400, "chartBarColor is not a supported palette color.");
  }
  return value;
}

function normalizeChartColorOrder(value: unknown, legacyColor?: string | null) {
  const requested = Array.isArray(value)
    ? value.filter(
        (color): color is string => typeof color === "string" && chartBarColors.has(color),
      )
    : [];
  const ordered = Array.from(new Set(requested));
  if (!ordered.length && legacyColor && chartBarColors.has(legacyColor)) ordered.push(legacyColor);
  return [...ordered, ...defaultChartColorOrder.filter((color) => !ordered.includes(color))];
}

function readChartColorOrder(value: unknown) {
  if (
    !Array.isArray(value) ||
    value.length !== defaultChartColorOrder.length ||
    value.some((color) => typeof color !== "string" || !chartBarColors.has(color)) ||
    new Set(value).size !== defaultChartColorOrder.length
  ) {
    throw new HttpError(400, "chartColorOrder must rank each supported chart color exactly once.");
  }
  return value as string[];
}

function readArray(value: unknown, field: string) {
  if (!Array.isArray(value)) throw new HttpError(400, `${field} must be an array.`);
  return JSON.stringify(value);
}

const defaultBgReceiptDelayDays = [10, 30, 60];

function normalizeBgReceiptDelayDays(value: unknown) {
  const source = Array.isArray(value) ? value : defaultBgReceiptDelayDays;
  const days = Array.from(
    new Set(
      source
        .map((item) => Number.parseInt(String(item), 10))
        .filter((item) => Number.isInteger(item) && item >= 0),
    ),
  ).sort((a, b) => a - b);
  return days.length ? days.slice(0, 6) : defaultBgReceiptDelayDays;
}

function readNonNegativeInteger(value: unknown, field: string) {
  const parsed =
    typeof value === "number" ? value : Number.parseInt(typeof value === "string" ? value : "", 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new HttpError(400, `${field} must be a non-negative number.`);
  }
  return Math.floor(parsed);
}

function readBgReceiptDelayDays(value: unknown) {
  if (!Array.isArray(value)) throw new HttpError(400, "bgReceiptDelayDays must be an array.");
  return normalizeBgReceiptDelayDays(value);
}

function readArrayValue(value: unknown, field: string) {
  if (!Array.isArray(value)) throw new HttpError(400, `${field} must be an array.`);
  return value;
}

function normalizeSpecialFileMarkers(value: unknown) {
  const source = Array.isArray(value) ? value : [];
  const seen = new Set<string>();
  const rows: Array<{ code: string; description: string }> = [];
  for (const item of source) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const code = String(record.code ?? "")
      .trim()
      .toUpperCase();
    if (!code || seen.has(code)) continue;
    seen.add(code);
    rows.push({
      code,
      description: String(record.description ?? "").trim(),
    });
  }
  return rows;
}

function readSpecialFileMarkers(value: unknown) {
  if (!Array.isArray(value)) throw new HttpError(400, "specialFileMarkers must be an array.");
  return normalizeSpecialFileMarkers(value);
}

function normalizePresetForStorage(preset: unknown) {
  if (!preset || typeof preset !== "object" || Array.isArray(preset)) return undefined;
  const candidate = preset as Record<string, unknown>;
  if (typeof candidate.id !== "string" || typeof candidate.name !== "string") return undefined;
  if (!Array.isArray(candidate.fieldKeys)) return undefined;
  return {
    id: candidate.id,
    name: candidate.name,
    fieldKeys: candidate.fieldKeys.filter((key): key is string => typeof key === "string"),
  };
}

function readPresetArray(value: unknown, field: string) {
  return readArrayValue(value, field).map(normalizePresetForStorage).filter(Boolean);
}

async function replaceUserTableFieldPresets(ownerKey: string, presets: unknown[]) {
  await pool.query(
    `insert into user_table_field_presets (owner_key, presets)
     values ($1, $2::jsonb)
     on conflict (owner_key)
     do update set presets = excluded.presets, updated_at = now()`,
    [ownerKey, JSON.stringify(presets)],
  );
}

function readStringArray(value: unknown, field: string) {
  return readArrayValue(value, field)
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeGemBiddingModes(value: unknown) {
  const defaults = ["Custom", "Catalogue", "Comparison"];
  const seen = new Set<string>();
  return [...defaults, ...fromDbJsonArray(value)]
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => {
      if (!item) return false;
      const key = item.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function readFileTypeGroups(value: unknown): FileTypeGroupSetting[] {
  return readArrayValue(value, "fileTypeGroups")
    .map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return undefined;
      const candidate = item as Record<string, unknown>;
      const fileType = toDbText(candidate.fileType);
      if (!fileType) return undefined;
      return {
        fileType,
        group: candidate.group === "contract" ? "contract" : "goodsServices",
      } satisfies FileTypeGroupSetting;
    })
    .filter((item): item is FileTypeGroupSetting => Boolean(item));
}

async function reconcileFileTypeChanges(
  nextFileTypes: string[],
  nextFileTypeGroups: FileTypeGroupSetting[],
) {
  const current = await pool.query<{ file_types: unknown; file_type_groups: unknown }>(
    "select file_types, file_type_groups from app_settings where id = true",
  );
  const currentFileTypes = fromDbJsonArray(current.rows[0]?.file_types).filter(
    (item): item is string => typeof item === "string",
  );
  const currentFileTypeGroups = normalizeFileTypeGroups(
    current.rows[0]?.file_type_groups,
    currentFileTypes,
  );
  const normalizedNextFileTypeGroups = normalizeFileTypeGroups(nextFileTypeGroups, nextFileTypes);
  const currentGroupByType = new Map(
    currentFileTypeGroups.map((entry) => [entry.fileType.trim().toLowerCase(), entry.group]),
  );
  const nextGroupByType = new Map(
    normalizedNextFileTypeGroups.map((entry) => [entry.fileType.trim().toLowerCase(), entry.group]),
  );
  const nextSet = new Set(nextFileTypes.map((fileType) => fileType.trim().toLowerCase()));
  const removedFileTypes = currentFileTypes
    .map((fileType) => fileType.trim())
    .filter((fileType) => fileType && !nextSet.has(fileType.toLowerCase()));

  await assertUsedFileTypeGroupsUnchanged(currentFileTypes, currentGroupByType, nextGroupByType);
  if (!removedFileTypes.length) return;

  const result = await pool.query<{ file_type: string; count: string }>(
    `select coalesce(nullif(trim(file_type), ''), '(blank)') as file_type, count(*)::text
     from files
     where lower(trim(coalesce(file_type, ''))) = any($1::text[])
     group by 1
     order by 1`,
    [removedFileTypes.map((fileType) => fileType.toLowerCase())],
  );
  if (!result.rows.length) return;

  const usedTypes = result.rows.map((row) => `${row.file_type} (${row.count})`).join(", ");
  throw new HttpError(
    400,
    `This file type is used by active or archived files, so its name cannot be changed or deleted: ${usedTypes}.`,
  );
}

async function assertUsedFileTypeGroupsUnchanged(
  currentFileTypes: string[],
  currentGroupByType: Map<string, FileTypeGroupSetting["group"]>,
  nextGroupByType: Map<string, FileTypeGroupSetting["group"]>,
) {
  const changedTypes = currentFileTypes
    .map((fileType) => fileType.trim())
    .filter((fileType) => {
      const key = fileType.toLowerCase();
      return nextGroupByType.has(key) && currentGroupByType.get(key) !== nextGroupByType.get(key);
    });
  if (!changedTypes.length) return;

  const result = await pool.query<{ file_type: string; count: string }>(
    `select coalesce(nullif(trim(file_type), ''), '(blank)') as file_type, count(*)::text
     from files
     where lower(trim(coalesce(file_type, ''))) = any($1::text[])
     group by 1
     order by 1`,
    [changedTypes.map((fileType) => fileType.toLowerCase())],
  );
  if (!result.rows.length) return;

  const usedTypes = result.rows.map((row) => `${row.file_type} (${row.count})`).join(", ");
  throw new HttpError(
    400,
    `This file type is used by active or archived files, so its workflow group cannot be changed: ${usedTypes}.`,
  );
}

function normalizeMasterValue(value: string) {
  return value.trim().toLowerCase();
}

function removedMasterValues(currentValues: string[], nextValues: string[]) {
  const nextSet = new Set(nextValues.map(normalizeMasterValue).filter(Boolean));
  return currentValues
    .map((value) => value.trim())
    .filter((value) => value && !nextSet.has(normalizeMasterValue(value)));
}

async function assertRemovedValuesUnused(
  label: string,
  removedValues: string[],
  usageQuery: string,
) {
  if (!removedValues.length) return;
  const result = await pool.query<{ value: string; count: string }>(usageQuery, [
    removedValues.map(normalizeMasterValue),
  ]);
  if (!result.rows.length) return;
  const usedValues = result.rows.map((row) => `${row.value} (${row.count})`).join(", ");
  throw new HttpError(409, `Cannot remove ${label} currently used by files: ${usedValues}.`);
}

async function assertFirmTypesCanChange(nextFirmTypes: string[]) {
  const settings = await getSettings();
  const removed = removedMasterValues(settings.firmTypes, nextFirmTypes);
  await assertRemovedValuesUnused(
    "firm types",
    removed,
    `select value, count(distinct file_id)::text as count
     from (
       select f.id as file_id, trim(f.firm_type) as value from files f
       union all
       select so.file_id, trim(so.firm_type) from supply_orders so
     ) used
     where lower(trim(value)) = any($1::text[])
     group by value`,
  );
}

async function assertModesCanChange(nextModes: string[]) {
  const settings = await getSettings();
  const removed = removedMasterValues(settings.modes, nextModes);
  await assertRemovedValuesUnused(
    "modes",
    removed,
    `select trim(mode) as value, count(*)::text as count
     from files
     where lower(trim(coalesce(mode, ''))) = any($1::text[])
     group by trim(mode)`,
  );
}

async function assertGemBiddingModesCanChange(nextModes: string[]) {
  const settings = await getSettings();
  const removed = removedMasterValues(settings.gemBiddingModes ?? [], nextModes);
  await assertRemovedValuesUnused(
    "GeM bidding modes",
    removed,
    `select trim(value) as value, count(distinct file_id)::text as count
     from (
       select id as file_id, trim(gem_bidding_mode) as value from files
       union all
       select id as file_id, trim(refloat_gem_bidding_mode) as value from files
     ) used
     where lower(trim(coalesce(value, ''))) = any($1::text[])
     group by trim(value)`,
  );
}

async function assertSpecialFileMarkersCanChange(nextMarkers: Array<{ code: string }>) {
  const settings = await getSettings();
  const currentCodes = normalizeSpecialFileMarkers(settings.specialFileMarkers).map(
    (marker) => marker.code,
  );
  const nextCodes = nextMarkers.map((marker) => marker.code);
  const removed = removedMasterValues(currentCodes, nextCodes);
  await assertRemovedValuesUnused(
    "special file marker codes",
    removed,
    `select trim(fm.text) as value, count(distinct fm.file_id)::text as count
     from file_markers fm
     where lower(trim(coalesce(fm.text, ''))) = any($1::text[])
     group by trim(fm.text)`,
  );
}

async function assertTcecCommitteesCanChange(financialYear: string, nextCommittees: string[]) {
  const settings = await getSettings();
  const current = await loadTcecCommittees(financialYear, settings.tcecCommittees);
  const removed = removedMasterValues(
    current.filter((item): item is string => typeof item === "string"),
    nextCommittees,
  );
  await assertRemovedValuesUnused(
    "TCEC committees",
    removed,
    `select value, count(distinct file_id)::text as count
     from (
       select f.id as file_id, trim(f.pre_tcec_committee_no) as value from files f
       union all
       select f.id, trim(f.post_tcec_committee_number) from files f
       union all
       select f.id, trim(f.refloat_post_tcec_committee_no) from files f
     ) used
     where lower(trim(value)) = any($1::text[])
     group by value`,
  );
}

async function assertMilestonesCanChange(nextMilestones: string[]) {
  const settings = await getSettings();
  const removed = removedMasterValues(settings.milestones, nextMilestones);
  await assertRemovedValuesUnused(
    "milestones",
    removed,
    `select value, count(distinct file_id)::text as count
     from (
       select f.id as file_id, trim(f.current_milestone) as value from files f
       union all
       select cm.file_id, trim(cm.milestone) from file_completed_milestones cm
       union all
       select so.file_id, trim(so.current_milestone) from supply_orders so
       union all
       select so.file_id, trim(completed.value)
       from supply_orders so
       cross join lateral jsonb_array_elements_text(coalesce(so.completed_milestones, '[]'::jsonb)) completed(value)
       union all
       select so.file_id, trim(so.advance_payment_detail ->> 'currentMilestone') from supply_orders so
       union all
       select so.file_id, trim(completed.value)
       from supply_orders so
       cross join lateral jsonb_array_elements_text(
         case
           when jsonb_typeof(so.advance_payment_detail -> 'completedMilestones') = 'array'
             then so.advance_payment_detail -> 'completedMilestones'
           else '[]'::jsonb
         end
       ) completed(value)
     ) used
     where lower(trim(value)) = any($1::text[])
     group by value`,
  );
}

function readMmgSummaryFields(value: unknown) {
  return readArrayValue(value, "mmgSummaryFields")
    .map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return undefined;
      const candidate = item as Record<string, unknown>;
      if (typeof candidate.key !== "string") return undefined;
      return {
        key: candidate.key,
        label: toDbText(candidate.label) || candidate.key,
        enabled: candidate.enabled !== false,
      };
    })
    .filter(Boolean);
}

function normalizeFirmRatingConfig(value: unknown): FirmRatingConfig {
  const source =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const fields = Array.isArray(source.fields) ? source.fields : defaultFirmRatingConfig.fields;
  const normalized = fields.reduce<FirmRatingConfig["fields"]>((result, item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return result;
    const candidate = item as Record<string, unknown>;
    const label = toDbText(candidate.label) || `Rating ${index + 1}`;
    const rawId = toDbText(candidate.id) || label;
    const id =
      rawId
        .replace(/[^a-zA-Z0-9]+(.)/g, (_match, chr: string) => chr.toUpperCase())
        .replace(/^[^a-zA-Z]+/, "")
        .replace(/^./, (chr) => chr.toLowerCase()) || `rating${index + 1}`;
    const weightText = toDbText(candidate.weight);
    const parsedWeight = Number.parseFloat(weightText ?? "");
    const minText = toDbText(candidate.minValue);
    const maxText = toDbText(candidate.maxValue);
    const parsedMin = Number(minText ?? "0");
    const parsedMax = Number(maxText ?? "5");
    result.push({
      id,
      label,
      weight: Number.isFinite(parsedWeight) && parsedWeight > 0 ? String(parsedWeight) : "1",
      minValue: Number.isFinite(parsedMin) ? String(parsedMin) : "0",
      maxValue: Number.isFinite(parsedMax) ? String(parsedMax) : "5",
    });
    return result;
  }, []);

  return { fields: normalized.length ? normalized : defaultFirmRatingConfig.fields };
}

async function replaceUserLiveStatusFields(ownerKey: string, fieldKeys: string[]) {
  await ensureUserLiveStatusPreferencesTable();
  await pool.query(
    `insert into user_live_status_preferences (owner_key, field_keys)
     values ($1, $2::jsonb)
     on conflict (owner_key)
     do update set field_keys = excluded.field_keys, updated_at = now()`,
    [ownerKey, JSON.stringify(fieldKeys)],
  );
}

async function replaceUserUiPreferences(
  userId: string,
  preferences: {
    theme?: AppTheme;
    themeTint?: AppThemeTint;
    appearancePreset?: AppearancePreset | null;
    fontFamily?: AppFontFamily | null;
    fontScale?: AppFontScale;
    topRibbonColor?: TopRibbonColor | null;
    topRibbonTextColor?: TopRibbonTextColor | null;
    chartBarColor?: string;
    chartColorOrder?: string[];
    addEditRibbonFields?: string[];
  },
) {
  await ensureUserUiPreferencesTable();
  const columns = ["user_id"];
  const placeholders = ["$1"];
  const values: unknown[] = [userId];
  const updates: string[] = [];
  const add = (column: string, value: unknown, cast = "") => {
    columns.push(column);
    values.push(value);
    const placeholder = `$${values.length}${cast}`;
    placeholders.push(placeholder);
    updates.push(`${column} = excluded.${column}`);
  };

  if ("theme" in preferences) add("theme", preferences.theme ?? null);
  if ("themeTint" in preferences) add("theme_tint", preferences.themeTint ?? null);
  if ("appearancePreset" in preferences)
    add("appearance_preset", preferences.appearancePreset ?? null);
  if ("fontFamily" in preferences) add("font_family", preferences.fontFamily ?? null);
  if ("fontScale" in preferences) add("font_scale", preferences.fontScale ?? 100);
  if ("topRibbonColor" in preferences) add("top_ribbon_color", preferences.topRibbonColor ?? null);
  if ("topRibbonTextColor" in preferences)
    add("top_ribbon_text_color", preferences.topRibbonTextColor ?? null);
  if ("chartBarColor" in preferences) add("chart_bar_color", preferences.chartBarColor ?? null);
  if ("chartColorOrder" in preferences) {
    add("chart_color_order", JSON.stringify(preferences.chartColorOrder ?? null), "::jsonb");
    if (!("chartBarColor" in preferences)) {
      add("chart_bar_color", preferences.chartColorOrder?.[0] ?? null);
    }
  }
  if ("addEditRibbonFields" in preferences)
    add(
      "add_edit_ribbon_fields",
      JSON.stringify(preferences.addEditRibbonFields ?? null),
      "::jsonb",
    );
  if (!updates.length) return;
  await pool.query(
    `insert into user_ui_preferences (${columns.join(", ")})
     values (${placeholders.join(", ")})
     on conflict (user_id)
     do update set ${updates.join(", ")},
       updated_at = now()`,
    values,
  );
}

async function replaceUserReportPreferences(
  userId: string,
  reportKey: string,
  preferences: Record<string, unknown>,
) {
  await ensureUserReportPreferencesTable();
  await pool.query(
    `insert into user_report_preferences (user_id, report_key, preferences)
     values ($1, $2, $3::jsonb)
     on conflict (user_id, report_key)
     do update set preferences = excluded.preferences, updated_at = now()`,
    [userId, reportKey, JSON.stringify(preferences)],
  );
}

settingsRouter.post(
  "/protected-backup/export",
  asyncHandler(async (request, response) => {
    const user = requireAuth(request as AuthRequest);
    if (user.role !== "admin") throw new HttpError(403, "Admin access required.");
    const body = requireObjectBody(request.body);
    const password = requireString(body.password, "password");
    if (password.length < 8) throw new HttpError(400, "Backup encryption password must be at least 8 characters.");
    const runId = await beginBackupRun("local", user.id);
    try {
      const { envelope, schema, rowCount, createdAt } = await buildProtectedBackupEnvelope(user, password);
      const fileTimestamp = createdAt.replace(/[:.]/g, "-");
      const fileName = `recordkeeper-backup-${fileTimestamp}.rbk`;
      await pool.query(
        `insert into protected_backup_log (created_by, table_count, row_count) values ($1, $2, $3)`,
        [user.id, schema.length, rowCount],
      );
      await finishBackupRun(runId, "success", {
        fileName,
        tableCount: schema.length,
        rowCount,
      });
      response.setHeader("Content-Type", "application/json");
      response.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
      response.json(envelope);
    } catch (error) {
      await finishBackupRun(runId, "failed", {
        errorMessage: error instanceof Error ? error.message : "Database backup failed.",
      });
      throw error;
    }
  }),
);

type FullRecoveryPackageResult = {
  temporaryRoot: string;
  archivePath: string;
  fileName: string;
  createdAt: string;
  schemaTableCount: number;
  applicationRowCount: number;
  externalStorageIncluded: boolean;
  deploymentConfigIncluded: boolean;
  deploymentSecretsIncluded: boolean;
};

async function createFullRecoveryPackage(
  user: BackupUser,
  password: string,
  destinationDirectory?: string,
): Promise<FullRecoveryPackageResult> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new HttpError(503, "DATABASE_URL is not configured on the server.");

  const createdAt = new Date().toISOString();
  const stamp = createdAt.replace(/[:.]/g, "-");
  const temporaryRoot = await fs.mkdtemp(join("/tmp", "recordkeeper-full-backup-"));
  const packageRoot = join(temporaryRoot, `recordkeeper-disaster-${stamp}`);
  const databaseDumpPath = join(packageRoot, "postgresql-database.dump");
  const globalsPath = join(packageRoot, "postgresql-globals.sql");
  const externalStoragePath = join(packageRoot, "external-storage.tar.gz");
  const deploymentDir = join(packageRoot, "deployment");
  const externalStorageDir = process.env.EXTERNAL_STORAGE_DIR?.trim();
  const configPath = process.env.RECORDKEEPER_BACKUP_CONFIG_FILE?.trim();
  const secretsPath = process.env.RECORDKEEPER_BACKUP_SECRETS_FILE?.trim();
  let externalStorageIncluded = false;
  let deploymentConfigIncluded = false;
  let deploymentSecretsIncluded = false;

  try {
    await fs.mkdir(deploymentDir, { recursive: true, mode: 0o700 });
    const { envelope, schema, rowCount } = await buildProtectedBackupEnvelope(user, password);
    await fs.writeFile(join(packageRoot, "application-backup.rbk"), JSON.stringify(envelope), {
      mode: 0o600,
    });

    await runBackupCommand(
      process.env.PG_DUMP_PATH?.trim() || "pg_dump",
      ["--format=custom", "--no-owner", "--file", databaseDumpPath, databaseUrl],
      "PostgreSQL database dump",
    );
    await runBackupCommand(
      process.env.PG_DUMPALL_PATH?.trim() || "pg_dumpall",
      // pg_dumpall treats an unflagged connection string as a positional
      // database argument on some PostgreSQL client versions.  Pass it via
      // --dbname so both the standard and older client parsers accept it.
      ["--globals-only", "--dbname", databaseUrl],
      "PostgreSQL globals dump",
      globalsPath,
    );

    if (externalStorageDir) {
      const externalStat = await fs.stat(externalStorageDir).catch(() => undefined);
      if (!externalStat?.isDirectory()) {
        throw new HttpError(503, "EXTERNAL_STORAGE_DIR is configured but does not exist or is not a directory.");
      }
      await runBackupCommand(
        process.env.TAR_PATH?.trim() || "tar",
        ["-czf", externalStoragePath, "-C", dirname(externalStorageDir), basename(externalStorageDir)],
        "External storage archive",
      );
      externalStorageIncluded = true;
    } else {
      await fs.writeFile(
        join(packageRoot, "external-storage-not-configured.txt"),
        "No EXTERNAL_STORAGE_DIR was configured on the server.\n",
        { mode: 0o600 },
      );
    }

    if (configPath) {
      await fs.copyFile(configPath, join(deploymentDir, "deployment-config"));
      deploymentConfigIncluded = true;
    }
    if (secretsPath) {
      await fs.copyFile(secretsPath, join(deploymentDir, "deployment-secrets"));
      deploymentSecretsIncluded = true;
    } else {
      await fs.writeFile(
        join(deploymentDir, "secrets-not-included.txt"),
        "Deployment secrets are intentionally not exported unless RECORDKEEPER_BACKUP_SECRETS_FILE is explicitly configured. Transfer secrets through the organisation's secure secret-management process.\n",
        { mode: 0o600 },
      );
    }

    const componentNames = (await fs.readdir(packageRoot, { withFileTypes: true }))
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .sort();
    const checksums: Record<string, string> = {};
    for (const componentName of componentNames) {
      checksums[componentName] = await sha256File(join(packageRoot, componentName));
    }
    await fs.writeFile(
      join(packageRoot, "manifest.json"),
      JSON.stringify(
        {
          format: fullBackupFormat,
          version: fullBackupVersion,
          createdAt,
          createdBy: user.username,
          applicationBackup: "application-backup.rbk",
          databaseDump: "postgresql-database.dump",
          postgresGlobals: "postgresql-globals.sql",
          externalStorage: externalStorageIncluded ? "external-storage.tar.gz" : null,
          deploymentConfig: deploymentConfigIncluded ? "deployment/deployment-config" : null,
          deploymentSecrets: deploymentSecretsIncluded ? "deployment/deployment-secrets" : null,
          schemaTableCount: schema.length,
          applicationRowCount: rowCount,
          checksums,
          restoreOrder: [
            "PostgreSQL roles/globals",
            "PostgreSQL database dump into a schema-compatible database",
            "external storage/uploads",
            "deployment configuration and secrets",
            "application .rbk only when application-level recovery is required",
          ],
        },
        null,
        2,
      ),
      { mode: 0o600 },
    );
    await fs.writeFile(
      join(packageRoot, "RECOVERY-README.txt"),
      "This archive is encrypted with the password supplied in Settings.\n" +
        "Keep it outside the application server and transfer it only through a secure channel.\n" +
        "A server administrator must restore PostgreSQL globals first, then the database dump,\n" +
        "external storage, and deployment configuration/secrets. Verify schema/migrations before restore.\n",
      { mode: 0o600 },
    );

    const fileName = `recordkeeper-disaster-${stamp}.rkdr`;
    const plainArchivePath = join(temporaryRoot, `recordkeeper-disaster-${stamp}.tar.gz`);
    const encryptedArchivePath = join(temporaryRoot, fileName);
    await runBackupCommand(
      process.env.TAR_PATH?.trim() || "tar",
      ["-czf", plainArchivePath, "-C", temporaryRoot, `recordkeeper-disaster-${stamp}`],
      "Recovery package archive",
    );
    await encryptRecoveryArchive(plainArchivePath, encryptedArchivePath, password, {
      createdAt,
      externalStorageIncluded,
      deploymentConfigIncluded,
      deploymentSecretsIncluded,
    });

    let archivePath = encryptedArchivePath;
    if (destinationDirectory) {
      await fs.mkdir(destinationDirectory, { recursive: true, mode: 0o700 });
      archivePath = join(destinationDirectory, fileName);
      await fs.copyFile(encryptedArchivePath, archivePath);
      await fs.rm(encryptedArchivePath, { force: true });
      await fs.chmod(archivePath, 0o600);
    }
    return {
      temporaryRoot,
      archivePath,
      fileName,
      createdAt,
      schemaTableCount: schema.length,
      applicationRowCount: rowCount,
      externalStorageIncluded,
      deploymentConfigIncluded,
      deploymentSecretsIncluded,
    };
  } catch (error) {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
    throw error;
  }
}

settingsRouter.post(
  "/protected-backup/full-export",
  asyncHandler(async (request, response) => {
    const user = requireAuth(request as AuthRequest);
    if (user.role !== "admin") throw new HttpError(403, "Admin access required.");
    const body = requireObjectBody(request.body);
    const password = requireString(body.password, "password");
    if (password.length < 8) throw new HttpError(400, "Backup encryption password must be at least 8 characters.");
    const runId = await beginBackupRun("full_recovery", user.id);
    let packageResult: FullRecoveryPackageResult | undefined;
    try {
      packageResult = await createFullRecoveryPackage(user, password);
      await pool.query(
        `insert into protected_backup_log (created_by, table_count, row_count) values ($1, $2, $3)`,
        [user.id, packageResult.schemaTableCount, packageResult.applicationRowCount],
      );
      response.setHeader("Content-Type", "application/octet-stream");
      response.setHeader(
        "Content-Disposition",
        `attachment; filename="${packageResult.fileName}"`,
      );
      await pipeline(createReadStream(packageResult.archivePath), response);
      await finishBackupRun(runId, "success", {
        fileName: packageResult.fileName,
        tableCount: packageResult.schemaTableCount,
        rowCount: packageResult.applicationRowCount,
        externalStorageIncluded: packageResult.externalStorageIncluded,
        deploymentConfigIncluded: packageResult.deploymentConfigIncluded,
        deploymentSecretsIncluded: packageResult.deploymentSecretsIncluded,
      });
    } catch (error) {
      await finishBackupRun(runId, "failed", {
        errorMessage: error instanceof Error ? error.message : "Full recovery backup failed.",
        ...(packageResult
          ? {
              tableCount: packageResult.schemaTableCount,
              rowCount: packageResult.applicationRowCount,
              externalStorageIncluded: packageResult.externalStorageIncluded,
              deploymentConfigIncluded: packageResult.deploymentConfigIncluded,
              deploymentSecretsIncluded: packageResult.deploymentSecretsIncluded,
            }
          : {}),
      });
      throw error;
    } finally {
      if (packageResult) {
        await fs.rm(packageResult.temporaryRoot, { recursive: true, force: true });
      }
    }
  }),
);

settingsRouter.post(
  "/protected-backup/full-restore",
  raw({ type: "application/octet-stream", limit: Infinity }),
  asyncHandler(async (request, response) => {
    const user = requireAuth(request as AuthRequest);
    if (user.role !== "admin") throw new HttpError(403, "Admin access required.");
    if (fullRecoveryRestoreInProgress) {
      throw new HttpError(409, "A full recovery restore is already in progress.");
    }
    const backupFilePassword = requireString(
      request.header("x-backup-file-password"),
      "backup encryption password",
    );
    const restoreAuthorizationPassword = requireString(
      request.header("x-restore-authorization-password"),
      "Upload password",
    );
    await verifyRestoreAuthorizationPassword(restoreAuthorizationPassword);
    if (!Buffer.isBuffer(request.body) || request.body.length === 0) {
      throw new HttpError(400, "Select a full recovery package first.");
    }
    const databaseUrl = process.env.DATABASE_URL?.trim();
    if (!databaseUrl) throw new HttpError(503, "DATABASE_URL is not configured on the server.");

    fullRecoveryRestoreInProgress = true;
    let restoreRoot: string | undefined;
    const warnings: string[] = [];
    try {
      restoreRoot = await fs.mkdtemp(join("/tmp", "recordkeeper-full-restore-"));
      const encryptedPath = join(restoreRoot, "recovery-package.rkdr");
      const archivePath = join(restoreRoot, "recovery-package.tar.gz");
      const unpackRoot = join(restoreRoot, "unpacked");
      await fs.writeFile(encryptedPath, request.body, { mode: 0o600 });
      await decryptRecoveryPackage(encryptedPath, archivePath, backupFilePassword);
      await fs.mkdir(unpackRoot, { recursive: true, mode: 0o700 });
      await runBackupCommand(
        process.env.TAR_PATH?.trim() || "tar",
        ["-xzf", archivePath, "--no-absolute-names", "--no-same-owner", "-C", unpackRoot],
        "Recovery package extraction",
      );
      const packageEntries = await fs.readdir(unpackRoot, { withFileTypes: true });
      const packageDirectories = packageEntries.filter((entry) => entry.isDirectory());
      if (packageDirectories.length !== 1) {
        throw new HttpError(400, "Recovery package contains an unexpected archive layout.");
      }
      const packageRoot = join(unpackRoot, packageDirectories[0].name);
      const manifest = await validateRecoveryPackage(packageRoot);
      const databaseDumpPath = packageRelativePath(packageRoot, manifest.databaseDump, "database dump");
      const globalsPath = packageRelativePath(packageRoot, manifest.postgresGlobals, "PostgreSQL globals");

      await runBackupCommand(
        process.env.PSQL_PATH?.trim() || "psql",
        ["--set", "ON_ERROR_STOP=on", "--dbname", databaseUrl, "--file", globalsPath],
        "PostgreSQL roles/globals restore",
      );
      await runBackupCommand(
        process.env.PG_RESTORE_PATH?.trim() || "pg_restore",
        [
          "--clean",
          "--if-exists",
          "--no-owner",
          "--exit-on-error",
          "--single-transaction",
          "--dbname",
          databaseUrl,
          databaseDumpPath,
        ],
        "PostgreSQL database restore",
      );

      const externalStorage = await restoreConfiguredExternalStorage(packageRoot, manifest);
      if (externalStorage.warning) warnings.push(externalStorage.warning);
      if (!externalStorage.restored && manifest.externalStorage) {
        warnings.push("External storage was not restored; uploaded files may be unavailable.");
      }

      const restoreDeploymentFiles = request.header("x-restore-deployment-files") === "true";
      const deploymentSecretsIncluded = Boolean(manifest.deploymentSecrets);
      if (restoreDeploymentFiles) {
        warnings.push(...await restoreConfiguredDeploymentFiles(packageRoot, manifest));
        if (manifest.deploymentConfig || manifest.deploymentSecrets) {
          warnings.push("Restart the backend service before the restored configuration or secrets take effect.");
        }
      } else if (manifest.deploymentConfig || manifest.deploymentSecrets) {
        warnings.push("Deployment configuration and secret files were not overwritten; the server kept its existing files.");
      }

      clearSettingsCache();
      clearDashboardReportCaches();
      response.json({
        restored: true,
        database: true,
        externalStorage: externalStorage.restored,
        deploymentConfig: Boolean(manifest.deploymentConfig),
        deploymentSecrets: deploymentSecretsIncluded,
        warnings,
      });
    } finally {
      if (restoreRoot) {
        await fs.rm(restoreRoot, { recursive: true, force: true }).catch(() => undefined);
      }
      fullRecoveryRestoreInProgress = false;
    }
  }),
);

type BackupScheduleFrequency = "daily" | "weekly";
type BackupScheduleStatus = "idle" | "running" | "success" | "failed";

type BackupScheduleRow = {
  enabled: boolean;
  frequency: BackupScheduleFrequency;
  day_of_week: number;
  time_of_day: string;
  timezone: string;
  destination_dir: string;
  retention_count: number;
  next_run_at: Date | null;
  last_started_at: Date | null;
  last_completed_at: Date | null;
  last_status: BackupScheduleStatus;
  last_error: string | null;
  last_file_name: string | null;
};

let backupScheduleSchemaReady: Promise<void> | undefined;

function getBackupScheduleTimeZone() {
  const configured = process.env.RECORDKEEPER_BACKUP_TIMEZONE?.trim() || "Asia/Kolkata";
  try {
    new Intl.DateTimeFormat("en-IN", { timeZone: configured }).format();
    return configured;
  } catch {
    return "Asia/Kolkata";
  }
}

function ensureBackupScheduleSchema() {
  backupScheduleSchemaReady ??= (async () => {
    await pool.query(`
      create table if not exists backup_schedule_settings (
        id boolean primary key default true check (id),
        enabled boolean not null default false,
        frequency text not null default 'daily' check (frequency in ('daily', 'weekly')),
        day_of_week smallint not null default 1 check (day_of_week between 0 and 6),
        time_of_day text not null default '02:00' check (time_of_day ~ '^(?:[01][0-9]|2[0-3]):[0-5][0-9]$'),
        timezone text not null default 'Asia/Kolkata',
        destination_dir text not null default '',
        retention_count integer not null default 7 check (retention_count between 1 and 90),
        next_run_at timestamptz,
        last_started_at timestamptz,
        last_completed_at timestamptz,
        last_status text not null default 'idle' check (last_status in ('idle', 'running', 'success', 'failed')),
        last_error text,
        last_file_name text,
        updated_by uuid references app_users(id) on delete set null,
        updated_at timestamptz not null default now()
      )
    `);
    await pool.query(
      `insert into backup_schedule_settings (id, timezone, destination_dir)
       values (true, $1, $2)
       on conflict (id) do nothing`,
      [
        getBackupScheduleTimeZone(),
        process.env.RECORDKEEPER_BACKUP_SCHEDULE_DIR?.trim() || "",
      ],
    );
  })();
  return backupScheduleSchemaReady;
}

function getZonedDateParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-IN", {
    timeZone,
    calendar: "gregory",
    numberingSystem: "latn",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts.filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]),
  );
  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
    second: values.second,
  };
}

function zonedDateTimeToUtc(
  parts: { year: number; month: number; day: number; hour: number; minute: number },
  timeZone: string,
) {
  const desired = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, 0, 0);
  let guess = desired;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const actualParts = getZonedDateParts(new Date(guess), timeZone);
    const actual = Date.UTC(
      actualParts.year,
      actualParts.month - 1,
      actualParts.day,
      actualParts.hour,
      actualParts.minute,
      actualParts.second,
      0,
    );
    const corrected = guess + (desired - actual);
    if (corrected === guess) break;
    guess = corrected;
  }
  return new Date(guess);
}

function nextBackupRunAt(
  schedule: Pick<BackupScheduleRow, "frequency" | "day_of_week" | "time_of_day" | "timezone">,
  now = new Date(),
) {
  const match = /^(\d{2}):(\d{2})$/.exec(schedule.time_of_day);
  if (!match) throw new HttpError(500, "Backup schedule time is invalid.");
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const localNow = getZonedDateParts(now, schedule.timezone);
  const localToday = Date.UTC(localNow.year, localNow.month - 1, localNow.day);
  const todayWeekday = new Date(localToday).getUTCDay();
  const firstOffset =
    schedule.frequency === "weekly"
      ? (schedule.day_of_week - todayWeekday + 7) % 7
      : 0;
  const increment = schedule.frequency === "weekly" ? 7 : 1;
  for (let dayOffset = firstOffset; dayOffset <= firstOffset + increment; dayOffset += increment) {
    const targetDate = new Date(localToday + dayOffset * 24 * 60 * 60 * 1000);
    const candidate = zonedDateTimeToUtc(
      {
        year: targetDate.getUTCFullYear(),
        month: targetDate.getUTCMonth() + 1,
        day: targetDate.getUTCDate(),
        hour,
        minute,
      },
      schedule.timezone,
    );
    if (candidate.getTime() > now.getTime()) return candidate;
  }
  throw new HttpError(500, "Could not calculate the next backup run.");
}

function mapBackupSchedule(row: BackupScheduleRow) {
  return {
    enabled: row.enabled,
    frequency: row.frequency,
    dayOfWeek: row.day_of_week,
    timeOfDay: row.time_of_day,
    timezone: row.timezone,
    destinationDir: row.destination_dir,
    retentionCount: row.retention_count,
    nextRunAt: row.next_run_at?.toISOString() ?? null,
    lastStartedAt: row.last_started_at?.toISOString() ?? null,
    lastCompletedAt: row.last_completed_at?.toISOString() ?? null,
    lastStatus: row.last_status,
    lastError: row.last_error,
    lastFileName: row.last_file_name,
    schedulePasswordConfigured: Boolean(process.env.RECORDKEEPER_BACKUP_SCHEDULE_PASSWORD?.trim()),
    externalStorageConfigured: Boolean(process.env.EXTERNAL_STORAGE_DIR?.trim()),
    deploymentConfigConfigured: Boolean(process.env.RECORDKEEPER_BACKUP_CONFIG_FILE?.trim()),
    deploymentSecretsConfigured: Boolean(process.env.RECORDKEEPER_BACKUP_SECRETS_FILE?.trim()),
  };
}

async function readBackupSchedule() {
  await ensureBackupScheduleSchema();
  const result = await pool.query<BackupScheduleRow>(
    `select enabled, frequency, day_of_week, time_of_day, timezone, destination_dir,
            retention_count, next_run_at, last_started_at, last_completed_at,
            last_status, last_error, last_file_name
     from backup_schedule_settings
     where id = true`,
  );
  if (!result.rows[0]) throw new HttpError(404, "Backup schedule settings not found.");
  return mapBackupSchedule(result.rows[0]);
}

type BackupHealthStatus = "success" | "failed" | "not_run" | "running" | "not_configured";

function serializeBackupRun(row: BackupRunRow | undefined) {
  if (!row) {
    return {
      status: "not_run" as BackupHealthStatus,
      lastBackupAt: null,
      fileName: null,
      error: null,
      secretsIncluded: false,
    };
  }
  return {
    status: (row.status === "success" ? "success" : row.status) as BackupHealthStatus,
    lastBackupAt: (row.completed_at ?? row.started_at).toISOString(),
    fileName: row.file_name,
    error: row.error_message,
    secretsIncluded: row.deployment_secrets_included,
  };
}

async function readBackupStatus() {
  await ensureBackupRunLogSchema();
  const result = await pool.query<BackupRunRow>(
    `select distinct on (backup_type)
            id, backup_type, status, started_at, completed_at, file_name, error_message,
            table_count, row_count, external_storage_included,
            deployment_config_included, deployment_secrets_included
     from backup_run_log
     order by backup_type, started_at desc`,
  );
  const latest = new Map(result.rows.map((row) => [row.backup_type, row]));
  const latestFullRecoveryRuns = result.rows
    .filter((row) => row.backup_type === "full_recovery" || row.backup_type === "server_scheduled")
    .sort((left, right) => right.started_at.getTime() - left.started_at.getTime());
  const latestFullRecovery = latestFullRecoveryRuns[0];
  const secretInspection = await inspectDeploymentSecrets();
  let secretStatus: BackupHealthStatus;
  let secretError: string | null = null;
  if (!secretInspection.configured) {
    secretStatus = "not_configured";
    secretError = "No deployment secret file is configured; this is optional for database recovery.";
  } else if (!latestFullRecovery) {
    secretStatus = "not_run";
    secretError = "No full recovery package has been completed yet.";
  } else if (latestFullRecovery.status === "running") {
    secretStatus = "running";
    secretError = "The latest full recovery package is still being created.";
  } else if (latestFullRecovery.status !== "success") {
    secretStatus = "failed";
    secretError = latestFullRecovery.error_message ?? "The latest full recovery package failed.";
  } else if (!secretInspection.readable) {
    secretStatus = "failed";
    secretError = secretInspection.error;
  } else if (!latestFullRecovery.deployment_secrets_included) {
    secretStatus = "failed";
    secretError = "The latest full recovery package did not include the configured secret file.";
  } else {
    secretStatus = "success";
  }
  const schedule = await readBackupSchedule();
  const restoreAuthorizationConfigured = await restoreAuthorizationPasswordIsConfigured();
  const restoreAuthorizationRecoveryConfigured =
    await restoreAuthorizationRecoveryPinIsConfigured();
  const scheduledRun = latest.get("server_scheduled");
  const scheduleError = schedule.enabled && !schedule.schedulePasswordConfigured
    ? "Scheduled server backup encryption password is not configured."
    : schedule.enabled && !schedule.destinationDir
      ? "Scheduled server backup destination is not configured."
      : null;
  const serializedScheduledRun = serializeBackupRun(scheduledRun);
  return {
    local: serializeBackupRun(latest.get("local")),
    fullRecovery: serializeBackupRun(latest.get("full_recovery")),
    server: {
      ...serializedScheduledRun,
      status: scheduleError ? "failed" : serializedScheduledRun.status,
      scheduleEnabled: schedule.enabled,
      error: scheduleError ?? serializedScheduledRun.error,
    },
    secretFiles: {
      status: secretStatus,
      configured: secretInspection.configured,
      readable: secretInspection.readable,
      lastIncludedAt:
        latestFullRecovery?.status === "success" && latestFullRecovery.deployment_secrets_included
          ? (latestFullRecovery.completed_at ?? latestFullRecovery.started_at).toISOString()
          : null,
      lastIncludedFileName:
        latestFullRecovery?.status === "success" && latestFullRecovery.deployment_secrets_included
          ? latestFullRecovery.file_name
          : null,
      error: secretError,
    },
    restoreAuthorizationConfigured,
    restoreAuthorizationRecoveryConfigured,
    schedule,
  };
}

async function pruneScheduledBackups(destinationDir: string, retentionCount: number) {
  const entries = await fs.readdir(destinationDir, { withFileTypes: true });
  const backups = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && /^recordkeeper-disaster-.*\.rkdr$/.test(entry.name))
      .map(async (entry) => ({
        name: entry.name,
        modifiedAt: (await fs.stat(join(destinationDir, entry.name))).mtimeMs,
      })),
  );
  backups.sort((left, right) => right.modifiedAt - left.modifiedAt);
  for (const backup of backups.slice(retentionCount)) {
    await fs.rm(join(destinationDir, backup.name), { force: true });
  }
}

let scheduledBackupRunning = false;

async function executeScheduledBackup(force: boolean, requestedBy?: BackupUser) {
  if (scheduledBackupRunning) return { started: false, reason: "already-running" };
  scheduledBackupRunning = true;
  const client = await pool.connect();
  let lockAcquired = false;
  try {
    await ensureBackupScheduleSchema();
    const lockResult = await client.query<{ locked: boolean }>(
      "select pg_try_advisory_lock(hashtext('recordkeeper.backup.scheduler')) as locked",
    );
    lockAcquired = Boolean(lockResult.rows[0]?.locked);
    if (!lockAcquired) return { started: false, reason: "another-server-instance" };

    const scheduleResult = await client.query<BackupScheduleRow>(
      `select enabled, frequency, day_of_week, time_of_day, timezone, destination_dir,
              retention_count, next_run_at, last_started_at, last_completed_at,
              last_status, last_error, last_file_name
       from backup_schedule_settings
       where id = true`,
    );
    const schedule = scheduleResult.rows[0];
    if (!schedule) return { started: false, reason: "not-configured" };
    const now = new Date();
    if (!force && !schedule.enabled) return { started: false, reason: "disabled" };
    if (!force && schedule.next_run_at && schedule.next_run_at.getTime() > now.getTime()) {
      return { started: false, reason: "not-due" };
    }
    if (!force && !schedule.next_run_at) {
      const nextRunAt = nextBackupRunAt(schedule, now);
      await client.query(
        "update backup_schedule_settings set next_run_at = $1, updated_at = now() where id = true",
        [nextRunAt],
      );
      return { started: false, reason: "scheduled" };
    }

    const password = process.env.RECORDKEEPER_BACKUP_SCHEDULE_PASSWORD?.trim();
    if (!password || password.length < 8) {
      throw new HttpError(503, "Configure RECORDKEEPER_BACKUP_SCHEDULE_PASSWORD before running scheduled server backups.");
    }
    const destinationDir = schedule.destination_dir.trim();
    if (!destinationDir || !isAbsolute(destinationDir)) {
      throw new HttpError(503, "Configure an absolute backup destination directory in Settings.");
    }

    const runId = await beginBackupRun("server_scheduled", requestedBy?.id ?? null);
    await client.query(
      `update backup_schedule_settings
       set last_status = 'running', last_started_at = now(), last_error = null, updated_at = now()
       where id = true`,
    );
    try {
      const packageResult = await createFullRecoveryPackage(
        requestedBy ?? { id: "", username: "server-scheduler" },
        password,
        destinationDir,
      );
      try {
        await client.query(
          `insert into protected_backup_log (created_by, table_count, row_count) values ($1, $2, $3)`,
          [requestedBy?.id || null, packageResult.schemaTableCount, packageResult.applicationRowCount],
        );
        await pruneScheduledBackups(destinationDir, schedule.retention_count);
        await finishBackupRun(runId, "success", {
          fileName: packageResult.fileName,
          tableCount: packageResult.schemaTableCount,
          rowCount: packageResult.applicationRowCount,
          externalStorageIncluded: packageResult.externalStorageIncluded,
          deploymentConfigIncluded: packageResult.deploymentConfigIncluded,
          deploymentSecretsIncluded: packageResult.deploymentSecretsIncluded,
        });
      } finally {
        await fs.rm(packageResult.temporaryRoot, { recursive: true, force: true });
      }
      const nextRunAt = schedule.enabled ? nextBackupRunAt(schedule, new Date()) : null;
      await client.query(
        `update backup_schedule_settings
         set last_status = 'success', last_completed_at = now(), last_error = null,
             last_file_name = $1, next_run_at = $2, updated_at = now()
         where id = true`,
        [packageResult.fileName, nextRunAt],
      );
      return { started: true, fileName: packageResult.fileName };
    } catch (error) {
      await finishBackupRun(runId, "failed", {
        errorMessage: error instanceof Error ? error.message : "Scheduled backup failed.",
      });
      const nextRunAt = schedule.enabled ? nextBackupRunAt(schedule, new Date()) : null;
      await client.query(
        `update backup_schedule_settings
         set last_status = 'failed', last_error = $1, next_run_at = $2, updated_at = now()
         where id = true`,
        [error instanceof Error ? error.message.slice(0, 1000) : "Backup failed.", nextRunAt],
      );
      throw error;
    }
  } finally {
    if (lockAcquired) {
      await client.query("select pg_advisory_unlock(hashtext('recordkeeper.backup.scheduler'))");
    }
    client.release();
    scheduledBackupRunning = false;
  }
}

settingsRouter.get(
  "/protected-backup/schedule",
  asyncHandler(async (request, response) => {
    const user = requireAuth(request as AuthRequest);
    if (user.role !== "admin") throw new HttpError(403, "Admin access required.");
    response.json({ schedule: await readBackupSchedule() });
  }),
);

settingsRouter.get(
  "/protected-backup/status",
  asyncHandler(async (request, response) => {
    const user = requireAuth(request as AuthRequest);
    if (user.role !== "admin") throw new HttpError(403, "Admin access required.");
    response.json({ status: await readBackupStatus() });
  }),
);

settingsRouter.get(
  "/protected-backup/restore-authorization",
  asyncHandler(async (request, response) => {
    const user = requireAuth(request as AuthRequest);
    if (user.role !== "admin") throw new HttpError(403, "Admin access required.");
    response.json({ configured: await restoreAuthorizationPasswordIsConfigured() });
  }),
);

settingsRouter.put(
  "/protected-backup/restore-authorization",
  asyncHandler(async (request, response) => {
    const user = requireAuth(request as AuthRequest);
    if (user.role !== "admin") throw new HttpError(403, "Admin access required.");
    const body = requireObjectBody(request.body);
    await saveRestoreAuthorizationPassword(
      body.currentPassword,
      body.password,
      body.confirmation,
      body.recoveryPin,
      body.recoveryPinConfirmation,
    );
    response.json({ configured: true });
  }),
);

settingsRouter.put(
  "/protected-backup/restore-authorization/recover",
  asyncHandler(async (request, response) => {
    const user = requireAuth(request as AuthRequest);
    if (user.role !== "admin") throw new HttpError(403, "Admin access required.");
    const body = requireObjectBody(request.body);
    const recoveryPin = readRestoreAuthorizationRecoveryPin(
      body.recoveryPin,
      "Upload password Recovery PIN",
    );
    const password = readRestoreAuthorizationPassword(body.password, "Upload password");
    const confirmation = readRestoreAuthorizationPassword(
      body.confirmation,
      "Confirm Upload password",
    );
    if (password !== confirmation) {
      throw new HttpError(400, "Upload passwords do not match.");
    }
    await ensureProtectedBackupAuthorizationSchema();
    const recoveryPinResult = await pool.query<{ configured: boolean; valid: boolean }>(
      `select
         restore_authorization_recovery_pin_hash <> '' as configured,
         restore_authorization_recovery_pin_hash <> ''
           and restore_authorization_recovery_pin_hash = crypt($1, restore_authorization_recovery_pin_hash) as valid
       from protected_backup_settings
       where id = true`,
      [recoveryPin],
    );
    if (!recoveryPinResult.rows[0]?.configured) {
      throw new HttpError(
        400,
        "Configure the six-digit Recovery PIN in Protected Backup settings before using Forgot password.",
      );
    }
    if (!recoveryPinResult.rows[0].valid) {
      throw new HttpError(403, "Incorrect Upload password Recovery PIN.");
    }
    await pool.query(
      `update protected_backup_settings
       set restore_authorization_password_hash = crypt($1, gen_salt('bf')), updated_at = now()
       where id = true`,
      [password],
    );
    response.json({ configured: true, recovered: true });
  }),
);

settingsRouter.post(
  "/protected-backup/restore-authorization/verify",
  asyncHandler(async (request, response) => {
    const user = requireAuth(request as AuthRequest);
    if (user.role !== "admin") throw new HttpError(403, "Admin access required.");
    const body = requireObjectBody(request.body);
    await verifyRestoreAuthorizationPassword(body.password);
    response.json({ authorized: true });
  }),
);

settingsRouter.put(
  "/protected-backup/schedule",
  asyncHandler(async (request, response) => {
    const user = requireAuth(request as AuthRequest);
    if (user.role !== "admin") throw new HttpError(403, "Admin access required.");
    const body = requireObjectBody(request.body);
    if (typeof body.enabled !== "boolean") throw new HttpError(400, "enabled must be true or false.");
    if (body.frequency !== "daily" && body.frequency !== "weekly") {
      throw new HttpError(400, "frequency must be daily or weekly.");
    }
    if (!Number.isInteger(body.dayOfWeek) || Number(body.dayOfWeek) < 0 || Number(body.dayOfWeek) > 6) {
      throw new HttpError(400, "dayOfWeek must be between 0 and 6.");
    }
    if (typeof body.timeOfDay !== "string" || !/^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/.test(body.timeOfDay)) {
      throw new HttpError(400, "timeOfDay must use HH:MM format.");
    }
    if (typeof body.destinationDir !== "string" || (body.enabled && !body.destinationDir.trim())) {
      throw new HttpError(400, "destinationDir is required when backups are enabled.");
    }
    const destinationDir = body.destinationDir.trim();
    if (destinationDir && !isAbsolute(destinationDir)) {
      throw new HttpError(400, "destinationDir must be an absolute server path.");
    }
    if (!Number.isInteger(body.retentionCount) || Number(body.retentionCount) < 1 || Number(body.retentionCount) > 90) {
      throw new HttpError(400, "retentionCount must be between 1 and 90.");
    }
    if (body.enabled) {
      const password = process.env.RECORDKEEPER_BACKUP_SCHEDULE_PASSWORD?.trim();
      if (!password || password.length < 8) {
        throw new HttpError(400, "Configure RECORDKEEPER_BACKUP_SCHEDULE_PASSWORD on the server before enabling scheduled backups.");
      }
    }
    await ensureBackupScheduleSchema();
    const timezone = getBackupScheduleTimeZone();
    const nextRunAt = body.enabled
      ? nextBackupRunAt(
          {
            frequency: body.frequency,
            day_of_week: Number(body.dayOfWeek),
            time_of_day: body.timeOfDay,
            timezone,
          },
          new Date(),
        )
      : null;
    await pool.query(
      `update backup_schedule_settings
       set enabled = $1, frequency = $2, day_of_week = $3, time_of_day = $4,
           timezone = $5, destination_dir = $6, retention_count = $7,
           next_run_at = $8, last_error = null, updated_by = $9, updated_at = now()
       where id = true`,
      [
        body.enabled,
        body.frequency,
        Number(body.dayOfWeek),
        body.timeOfDay,
        timezone,
        destinationDir,
        Number(body.retentionCount),
        nextRunAt,
        user.id,
      ],
    );
    response.json({ schedule: await readBackupSchedule() });
  }),
);

settingsRouter.post(
  "/protected-backup/schedule/run",
  asyncHandler(async (request, response) => {
    const user = requireAuth(request as AuthRequest);
    if (user.role !== "admin") throw new HttpError(403, "Admin access required.");
    const result = await executeScheduledBackup(true, { id: user.id, username: user.username });
    response.json({ result, schedule: await readBackupSchedule() });
  }),
);

let backupSchedulerTimer: ReturnType<typeof setInterval> | undefined;

export function startBackupScheduler() {
  if (backupSchedulerTimer) return;
  const intervalMs = Math.max(
    15_000,
    Number(process.env.RECORDKEEPER_BACKUP_SCHEDULER_INTERVAL_MS ?? 60_000) || 60_000,
  );
  backupSchedulerTimer = setInterval(() => {
    void executeScheduledBackup(false).catch((error) => {
      console.error("Scheduled backup failed:", error);
    });
  }, intervalMs);
  void executeScheduledBackup(false).catch((error) => {
    console.error("Scheduled backup check failed:", error);
  });
}

settingsRouter.post(
  "/protected-backup/restore",
  asyncHandler(async (request, response) => {
    const user = requireAuth(request as AuthRequest);
    if (user.role !== "admin") throw new HttpError(403, "Admin access required.");
    const body = requireObjectBody(request.body);
    const backupFilePassword = requireString(body.backupFilePassword, "backupFilePassword");
    const restoreAuthorizationPassword = requireString(
      body.restoreAuthorizationPassword,
      "restoreAuthorizationPassword",
    );
    await verifyRestoreAuthorizationPassword(restoreAuthorizationPassword);
    const backup = decryptProtectedBackup(body.backup, backupFilePassword);
    if (backup.format !== protectedBackupFormat || typeof backup.tables !== "object" || !backup.tables) {
      throw new HttpError(400, "Backup contents are invalid.");
    }
    const tables = backup.tables as Record<string, unknown>;
    const isCurrentBackup = backup.schemaVersion === protectedBackupSchemaVersion;
    const backupSchema = isCurrentBackup && backup.schema && typeof backup.schema === "object"
      ? backup.schema as { tables?: unknown; fingerprint?: unknown }
      : undefined;
    if (isCurrentBackup && (!backupSchema || !Array.isArray(backupSchema.tables))) {
      throw new HttpError(400, "Backup schema metadata is missing or invalid.");
    }
    const client = await pool.connect();
    try {
      await client.query("begin");
      const currentSchema = await readPublicTableSchema((sql) => client.query(sql));
      const currentTableNames = new Set(currentSchema.map((table) => table.tableName));
      const backupTableNames = Object.keys(tables);
      if (isCurrentBackup) {
        const declaredTables = (Array.isArray(backupSchema?.tables) ? backupSchema.tables : []).filter(
          (table): table is { name: string; columns: string[] } =>
            Boolean(table) &&
            typeof table === "object" &&
            typeof (table as { name?: unknown }).name === "string" &&
            Array.isArray((table as { columns?: unknown }).columns) &&
            (table as { columns: unknown[] }).columns.every((column) => typeof column === "string"),
        );
        const declaredTableNames = new Set(declaredTables.map((table) => table.name));
        const missingTables = currentSchema
          .map((table) => table.tableName)
          .filter((tableName) => !declaredTableNames.has(tableName) || !Object.hasOwn(tables, tableName));
        const unknownTables = backupTableNames.filter((tableName) => !currentTableNames.has(tableName));
        if (missingTables.length || unknownTables.length) {
          throw new HttpError(
            400,
            `Backup schema is incompatible. Missing tables: ${missingTables.join(", ") || "none"}; ` +
              `unknown tables: ${unknownTables.join(", ") || "none"}.`,
          );
        }
        const declaredFingerprint = typeof backupSchema?.fingerprint === "string"
          ? backupSchema.fingerprint
          : "";
        if (declaredFingerprint && declaredFingerprint !== schemaFingerprint(
          declaredTables.map((table) => ({ tableName: table.name, columns: table.columns })),
        )) {
          throw new HttpError(400, "Backup schema metadata is inconsistent.");
        }
      }
      const currentSchemaByTable = new Map(currentSchema.map((table) => [table.tableName, table]));
      const tableNames = backupTableNames.filter((name) => currentTableNames.has(name));
      if (!tableNames.length) throw new HttpError(400, "Backup contains no restorable application tables.");
      for (const tableName of tableNames) {
        const table = tables[tableName];
        if (!table || typeof table !== "object") {
          throw new HttpError(400, `Backup table ${tableName} is invalid.`);
        }
        const value = table as { columns?: unknown; rows?: unknown };
        if (!Array.isArray(value.columns) || !Array.isArray(value.rows)) {
          throw new HttpError(400, `Backup table ${tableName} is incomplete.`);
        }
        const columns = value.columns;
        if (!columns.length || columns.some((column) => typeof column !== "string" || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(column))) {
          throw new HttpError(400, `Backup table ${tableName} has invalid columns.`);
        }
        if (value.rows.some((row) => !Array.isArray(row) || row.length !== columns.length)) {
          throw new HttpError(400, `Backup table ${tableName} has invalid rows.`);
        }
        if (isCurrentBackup) {
          const expectedColumns = currentSchemaByTable.get(tableName)?.columns ?? [];
          const missingColumns = expectedColumns.filter((column) => !columns.includes(column));
          const unknownColumns = columns.filter((column) => !expectedColumns.includes(column));
          if (missingColumns.length || unknownColumns.length) {
            throw new HttpError(
              400,
              `Backup table ${tableName} is incompatible. Missing columns: ${missingColumns.join(", ") || "none"}; ` +
                `unknown columns: ${unknownColumns.join(", ") || "none"}.`,
            );
          }
        }
      }
      await client.query(`truncate table ${tableNames.map(quoteIdentifier).join(", ")} restart identity cascade`);
      await client.query("set local session_replication_role = replica");
      let restoredRows = 0;
      for (const tableName of tableNames) {
        const table = tables[tableName];
        if (!table || typeof table !== "object") continue;
        const value = table as { columns?: unknown; rows?: unknown };
        const columns = Array.isArray(value.columns)
          ? value.columns.filter((column): column is string => typeof column === "string" && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(column))
          : [];
        const rows = Array.isArray(value.rows) ? value.rows.filter(Array.isArray) as unknown[][] : [];
        if (!columns.length || !rows.length) continue;
        const existingColumnsResult = await client.query<{ column_name: string; data_type: string; udt_name: string }>(
          `select column_name, data_type, udt_name
           from information_schema.columns
           where table_schema = 'public' and table_name = $1`,
          [tableName],
        );
        const existingColumns = new Set(existingColumnsResult.rows.map((row) => row.column_name));
        const usableColumns = columns.filter((column) => existingColumns.has(column));
        const columnTypes = new Map(
          existingColumnsResult.rows.map((row) => [row.column_name, row.data_type === "USER-DEFINED" ? row.udt_name : row.data_type]),
        );
        if (!usableColumns.length) continue;
        for (let offset = 0; offset < rows.length; offset += 200) {
          const batch = rows.slice(offset, offset + 200);
          const values: unknown[] = [];
          const placeholders = batch.map((row, rowIndex) => `(${usableColumns.map((_, columnIndex) => {
            const column = usableColumns[columnIndex];
            const rawValue = row[columns.indexOf(column)] ?? null;
            const valueType = columnTypes.get(column);
            values.push(
              rawValue !== null && (valueType === "json" || valueType === "jsonb") && typeof rawValue !== "string"
                ? JSON.stringify(rawValue)
                : rawValue,
            );
            return `$${values.length}`;
          }).join(", ")})`).join(", ");
          await client.query(
            `insert into ${quoteIdentifier(tableName)} (${usableColumns.map(quoteIdentifier).join(", ")}) values ${placeholders}`,
            values,
          );
          restoredRows += batch.length;
        }
      }
      // Inserts preserve backed-up IDs, so advance every identity/serial
      // sequence before the next normal write. Without this, the first new
      // record after a restore can collide with an existing primary key.
      await resetPublicSequences(client);
      await client.query("commit");
      clearSettingsCache();
      clearDashboardReportCaches();
      response.json({ restored: true, tables: tableNames.length, rows: restoredRows });
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }),
);

settingsRouter.get(
  "/",
  asyncHandler(async (request, response) => {
    const user = requireAuth(request as AuthRequest);
    const settings = await getSettings(user);
    response.json({
      settings: {
        ...settings,
        deletionPassword: "",
        deletionPasswordConfigured: await deletionPasswordIsConfigured(user.id),
        activeUserId: user.id,
      },
    });
  }),
);

settingsRouter.put(
  "/deletion-password",
  asyncHandler(async (request, response) => {
    const user = requireAuth(request as AuthRequest);
    const body = requireObjectBody(request.body);
    await saveDeletionPassword(
      user.id,
      body.deletionPassword,
      body.deletionPasswordConfirmation,
    );
    response.json({ configured: true });
  }),
);

settingsRouter.post(
  "/verify-deletion-password",
  asyncHandler(async (request, response) => {
    const user = requireAuth(request as AuthRequest);
    const body = requireObjectBody(request.body);
    await verifyDeletionPassword(user.id, body.deletionPassword);
    response.json({ valid: true });
  }),
);

settingsRouter.patch(
  "/financial-years/:label/archive",
  asyncHandler(async (request, response) => {
    const user = requireAuth(request as AuthRequest);
    if (user.role !== "admin") {
      throw new HttpError(403, "Admin access required.");
    }
    const label = requireParam(request.params.label, "label").trim();
    if (!label || !isFinancialYearLabel(label)) {
      throw new HttpError(400, "label must be a valid financial year like 2026-27.");
    }
    const body = requireObjectBody(request.body);
    if (typeof body.archived !== "boolean") {
      throw new HttpError(400, "archived must be true or false.");
    }
    const settings = await getSettings(user);
    if (!settings.financialYears.includes(label)) {
      throw new HttpError(404, "Financial year not found.");
    }
    if (body.archived && label === settings.financialYear) {
      throw new HttpError(400, "Current financial year cannot be archived.");
    }
    const result = await pool.query(
      `update financial_years
       set is_archived = $1,
           archived_at = case when $1 then now() else null end,
           archived_by = case when $1 then $2::uuid else null end
       where label = $3`,
      [body.archived, user.id, label],
    );
    if (!result.rowCount) throw new HttpError(404, "Financial year not found.");
    clearSettingsCache();
    response.json({ settings: await getSettings(user) });
  }),
);

settingsRouter.get(
  "/report-preferences/:reportKey",
  asyncHandler(async (request, response) => {
    const user = requireAuth(request as AuthRequest);
    const reportKey = requireParam(request.params.reportKey, "reportKey");
    if (!isStoredAppUser(user)) {
      response.json({ preferences: {} });
      return;
    }
    const preferences = await loadUserReportPreferences(user.id, reportKey);
    response.json({ preferences });
  }),
);

settingsRouter.get(
  "/notice-board-preferences",
  asyncHandler(async (request, response) => {
    const user = requireAuth(request as AuthRequest);
    if (!isStoredAppUser(user)) {
      response.json({ preferences: noticeBoardPersonalDefaults, saved: false });
      return;
    }
    const stored = await loadUserReportPreferences(user.id, "noticeBoard");
    response.json({
      preferences: normalizeNoticeBoardPersonalPreferences(stored),
      saved: Boolean(
        stored &&
        typeof stored === "object" &&
        !Array.isArray(stored) &&
        Object.keys(stored).length,
      ),
    });
  }),
);

settingsRouter.patch(
  "/notice-board-preferences",
  asyncHandler(async (request, response) => {
    const user = requireAuth(request as AuthRequest);
    if (!isStoredAppUser(user))
      throw new HttpError(403, "This account cannot save Notice Board preferences.");
    const body = requireObjectBody(request.body);
    const preferences = normalizeNoticeBoardPersonalPreferences(body);
    await replaceUserReportPreferences(user.id, "noticeBoard", preferences);
    response.json({ preferences });
  }),
);

settingsRouter.get(
  "/ip-access",
  asyncHandler(async (request, response) => {
    const user = requireAuth(request as AuthRequest);
    if (user.role !== "admin") throw new HttpError(403, "Admin access required.");
    response.json({ ipAccess: await getIpAccessConfig(getRequestIp(request)) });
  }),
);

settingsRouter.patch(
  "/ip-access",
  asyncHandler(async (request, response) => {
    const user = requireAuth(request as AuthRequest);
    if (user.role !== "admin") throw new HttpError(403, "Admin access required.");
    const body = requireObjectBody(request.body);
    const mode = requireString(body.mode, "mode") as IpAccessMode;
    if (!ipAccessModes.has(mode)) {
      throw new HttpError(400, "mode must be off, notify, or restrict.");
    }
    await updateIpAccessMode(mode, user);
    response.json({ ipAccess: await getIpAccessConfig(getRequestIp(request)) });
  }),
);

settingsRouter.post(
  "/ip-access/trusted",
  asyncHandler(async (request, response) => {
    const user = requireAuth(request as AuthRequest);
    if (user.role !== "admin") throw new HttpError(403, "Admin access required.");
    const body = requireObjectBody(request.body);
    await addTrustedIp(
      requireString(body.ipAddress, "ipAddress"),
      typeof body.remarks === "string" ? body.remarks : "",
      user,
    );
    response.status(201).json({ ipAccess: await getIpAccessConfig(getRequestIp(request)) });
  }),
);

settingsRouter.patch(
  "/ip-access/trusted/:id",
  asyncHandler(async (request, response) => {
    const user = requireAuth(request as AuthRequest);
    if (user.role !== "admin") throw new HttpError(403, "Admin access required.");
    const id = requireParam(request.params.id, "id");
    const body = requireObjectBody(request.body);
    await updateTrustedIp(
      id,
      {
        ...(typeof body.remarks === "string" ? { remarks: body.remarks } : {}),
        ...(typeof body.active === "boolean" ? { active: body.active } : {}),
      },
      user,
    );
    response.json({ ipAccess: await getIpAccessConfig(getRequestIp(request)) });
  }),
);

settingsRouter.post(
  "/ip-access/attempts/:id/archive",
  asyncHandler(async (request, response) => {
    const user = requireAuth(request as AuthRequest);
    if (user.role !== "admin") throw new HttpError(403, "Admin access required.");
    const id = requireParam(request.params.id, "id");
    await archiveIpAttempt(id, user);
    response.json({ ipAccess: await getIpAccessConfig(getRequestIp(request)) });
  }),
);

settingsRouter.delete(
  "/ip-access/attempts/:id",
  asyncHandler(async (request, response) => {
    const user = requireAuth(request as AuthRequest);
    if (user.role !== "admin") throw new HttpError(403, "Admin access required.");
    const id = requireParam(request.params.id, "id");
    const body = requireObjectBody(request.body);
    await verifyDeletionPassword(user.id, body.deletionPassword);
    await deleteArchivedIpAttempt(id);
    response.json({ ipAccess: await getIpAccessConfig(getRequestIp(request)) });
  }),
);

settingsRouter.put(
  "/report-preferences/:reportKey",
  asyncHandler(async (request, response) => {
    const user = requireAuth(request as AuthRequest);
    const reportKey = requireParam(request.params.reportKey, "reportKey");
    const body = requireObjectBody(request.body);
    if (!isStoredAppUser(user)) {
      response.json({ preferences: {} });
      return;
    }
    await replaceUserReportPreferences(user.id, reportKey, body);
    response.json({ preferences: await loadUserReportPreferences(user.id, reportKey) });
  }),
);

settingsRouter.post(
  "/chart-colors/reset-all",
  asyncHandler(async (request, response) => {
    const user = requireAuth(request as AuthRequest);
    if (user.role !== "admin") throw new HttpError(403, "Admin access required.");
    await ensureUserUiPreferencesTable();
    await ensurePreSoSettingsSchema();
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(
        "update user_ui_preferences set chart_bar_color = null, chart_color_order = null, updated_at = now()",
      );
      await client.query(
        `update app_settings
         set global_chart_color_order = $1::jsonb,
             global_chart_colors_enforced = true
         where id = true`,
        [JSON.stringify(defaultChartColorOrder)],
      );
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
    clearSettingsCache();
    response.json({ settings: await getSettings(user) });
  }),
);

settingsRouter.patch(
  "/",
  asyncHandler(async (request, response) => {
    const user = requireAuth(request as AuthRequest);
    await ensurePreSoSettingsSchema();
    const body = requireObjectBody(request.body);
    const bodyFields = Object.keys(body);
    // These values change shared application behaviour for every account. Keep
    // them separate from personal display preferences so a non-admin cannot
    // smuggle a global update through an otherwise valid preference request.
    const adminOnlySettingsFields = new Set([
      "financialYear",
      "selectedYear",
      "setupYear",
      "financialYearStatuses",
      "yearSelectionLocked",
      "tcecCommittees",
      "valueThresholdLevels",
      "milestones",
      "firmTypes",
      "fileTypes",
      "fileTypeGroups",
      "modes",
      "gemBiddingModes",
      "mmgLiveEnabled",
      "mmgLiveOptions",
      "mmgSummaryFields",
      "demandProcessingPresets",
      "demandProcessingDayRanges",
      "bgReceiptDelayDays",
      "specialFileMarkers",
      "firmUniqueNoLabel",
      "firmRatingConfig",
      "preSoDefaultSoOffsetDays",
      "preSoDefaultPaymentOffsetDays",
      "bgReturnOffsetDays",
      "delayStatusDefaultDays",
      "sharedQuickAccess",
      "quickEntryExcelPresets",
      "quickEntryExcelPresetsLegacyImported",
      "globalChartColorOrder",
      "globalChartColorsEnforced",
      "activeUserId",
    ]);
    const attemptedAdminOnlyFields = bodyFields.filter((field) =>
      adminOnlySettingsFields.has(field),
    );
    if (attemptedAdminOnlyFields.length > 0 && user.role !== "admin") {
      throw new HttpError(403, "Admin access required for shared settings.");
    }
    const userEditableFields = new Set([
      "theme",
      "themeTint",
      "appearancePreset",
      "fontFamily",
      "fontScale",
      "topRibbonColor",
      "topRibbonTextColor",
      "chartBarColor",
      "chartColorOrder",
      "tableFieldPresets",
      "liveStatusLockedFields",
      "addEditRibbonFields",
    ]);
    const canUpdateTableFieldPresets =
      !("tableFieldPresets" in body) ||
      user.role === "admin" ||
      user.role === "sub_admin" ||
      user.role === "editor" ||
      user.role === "division_user" ||
      user.role === "viewer" ||
      user.role === "universal_viewer";
    const canUpdateMmgSummaryFields = !("mmgSummaryFields" in body) || user.role === "admin";
    const preSoDefaultFields = new Set([
      "preSoDefaultSoOffsetDays",
      "preSoDefaultPaymentOffsetDays",
      "bgReturnOffsetDays",
      "delayStatusDefaultDays",
    ]);
    const canUpdatePreSoDefaults =
      bodyFields.length > 0 &&
      bodyFields.every((field) => preSoDefaultFields.has(field)) &&
      user.role === "admin";
    const canUpdateGemBiddingModes =
      bodyFields.length > 0 &&
      bodyFields.every((field) => field === "gemBiddingModes") &&
      user.role === "admin";
    const canUpdateFinancialYearStatuses =
      bodyFields.length > 0 &&
      bodyFields.every((field) => field === "financialYearStatuses") &&
      user.role === "admin";
    const changesChartPreference = "chartColorOrder" in body || "chartBarColor" in body;
    if (changesChartPreference && (await getSettings(user)).globalChartColorsEnforced) {
      throw new HttpError(
        409,
        "Chart colours are currently set by an administrator for all users.",
      );
    }
    const canUpdateUserPreference =
      canUpdateTableFieldPresets &&
      canUpdateMmgSummaryFields &&
      bodyFields.length > 0 &&
      bodyFields.every((field) => userEditableFields.has(field));
    if (
      user.role !== "admin" &&
      !canUpdateUserPreference &&
      !canUpdatePreSoDefaults &&
      !canUpdateGemBiddingModes &&
      !canUpdateFinancialYearStatuses
    )
      throw new HttpError(403, "Admin access required.");
    const fields: string[] = [];
    const values: unknown[] = [];

    const addField = (column: string, value: unknown, cast = "") => {
      values.push(value);
      fields.push(`${column} = $${values.length}${cast}`);
    };

    if ("financialYear" in body) {
      const financialYear = normalizeYearLabel(body.financialYear, "financialYear");
      await ensureFinancialYear(financialYear);
      addField("financial_year", financialYear);
    }
    if ("selectedYear" in body) {
      const selectedYear = normalizeYearLabel(body.selectedYear, "selectedYear");
      if (
        selectedYear !== allFilesYear &&
        selectedYear !== allActiveFilesYear &&
        selectedYear !== activePlusCurrentFyClosedYear
      ) {
        await ensureFinancialYear(selectedYear);
      }
      addField("selected_year", selectedYear);
    }
    if ("setupYear" in body) {
      const setupYear = normalizeYearLabel(body.setupYear, "setupYear");
      if (
        setupYear === allFilesYear ||
        setupYear === allActiveFilesYear ||
        setupYear === activePlusCurrentFyClosedYear
      ) {
        throw new HttpError(400, "setupYear must be a financial year like 2026-27.");
      }
      await ensureFinancialYear(setupYear);
      addField("setup_year", setupYear);
    }
    if ("financialYearStatuses" in body) {
      if (user.role !== "admin") {
        throw new HttpError(403, "Admin access required.");
      }
      const statuses = readFinancialYearStatuses(body.financialYearStatuses);
      const settings = await getSettings(user);
      const knownYears = new Set(settings.financialYears);
      for (const status of statuses) {
        if (!knownYears.has(status.label)) {
          throw new HttpError(400, `Financial year ${status.label} does not exist.`);
        }
        if (status.archived && status.label === settings.financialYear) {
          throw new HttpError(400, "Current financial year cannot be archived.");
        }
      }
      await ensureFinancialYearArchiveSchema();
      const client = await pool.connect();
      try {
        await client.query("begin");
        for (const status of statuses) {
          await client.query(
            `update financial_years
             set is_archived = $1,
                 archived_at = case when $1 then now() else null end,
                 archived_by = case when $1 then $2::uuid else null end
             where label = $3`,
            [status.archived, user.id, status.label],
          );
        }
        await client.query("commit");
      } catch (error) {
        await client.query("rollback");
        throw error;
      } finally {
        client.release();
      }
    }
    if ("yearSelectionLocked" in body)
      addField("year_selection_locked", body.yearSelectionLocked === true);
    if ("globalChartColorOrder" in body || "globalChartColorsEnforced" in body) {
      if (user.role !== "admin") throw new HttpError(403, "Admin access required.");
      if ("globalChartColorOrder" in body) {
        addField(
          "global_chart_color_order",
          JSON.stringify(readChartColorOrder(body.globalChartColorOrder)),
          "::jsonb",
        );
      }
      if ("globalChartColorsEnforced" in body) {
        if (typeof body.globalChartColorsEnforced !== "boolean") {
          throw new HttpError(400, "globalChartColorsEnforced must be true or false.");
        }
        addField("global_chart_colors_enforced", body.globalChartColorsEnforced);
      }
    }
    if (
      isStoredAppUser(user) &&
      ("theme" in body ||
        "themeTint" in body ||
        "appearancePreset" in body ||
        "fontFamily" in body ||
        "fontScale" in body ||
        "topRibbonColor" in body ||
        "topRibbonTextColor" in body ||
        "chartBarColor" in body ||
        "chartColorOrder" in body ||
        "addEditRibbonFields" in body)
    ) {
      await replaceUserUiPreferences(user.id, {
        ...("theme" in body ? { theme: readTheme(body.theme) } : {}),
        ...("themeTint" in body ? { themeTint: readThemeTint(body.themeTint) } : {}),
        ...("appearancePreset" in body
          ? { appearancePreset: readAppearancePreset(body.appearancePreset) }
          : {}),
        ...("fontFamily" in body ? { fontFamily: readFontFamily(body.fontFamily) } : {}),
        ...("fontScale" in body ? { fontScale: readFontScale(body.fontScale) } : {}),
        ...("topRibbonColor" in body
          ? { topRibbonColor: readOptionalTopRibbonColor(body.topRibbonColor) }
          : {}),
        ...("topRibbonTextColor" in body
          ? { topRibbonTextColor: readOptionalTopRibbonTextColor(body.topRibbonTextColor) }
          : {}),
        ...("chartBarColor" in body
          ? { chartBarColor: readChartBarColor(body.chartBarColor) }
          : {}),
        ...("chartBarColor" in body && !("chartColorOrder" in body)
          ? {
              chartColorOrder: [
                readChartBarColor(body.chartBarColor),
                ...defaultChartColorOrder.filter((color) => color !== body.chartBarColor),
              ],
            }
          : {}),
        ...("chartColorOrder" in body
          ? { chartColorOrder: readChartColorOrder(body.chartColorOrder) }
          : {}),
        ...("addEditRibbonFields" in body
          ? { addEditRibbonFields: readAddEditRibbonFields(body.addEditRibbonFields) }
          : {}),
      });
    }
    if ("tcecCommittees" in body) {
      const settings = await getSettings();
      const financialYear =
        typeof body.setupYear === "string" && body.setupYear.trim()
          ? body.setupYear.trim()
          : settings.setupYear;
      const tcecCommittees = readStringArray(body.tcecCommittees, "tcecCommittees");
      await assertTcecCommitteesCanChange(financialYear, tcecCommittees);
      await replaceTcecCommittees(financialYear, tcecCommittees);
    }
    if ("valueThresholdLevels" in body) {
      await replaceValueThresholdLevels(
        readArrayValue(body.valueThresholdLevels, "valueThresholdLevels"),
      );
    }
    if ("milestones" in body) {
      const milestones = readStringArray(body.milestones, "milestones");
      await assertMilestonesCanChange(milestones);
      addField("milestones", JSON.stringify(milestones), "::jsonb");
    }
    if ("firmTypes" in body) {
      const firmTypes = readStringArray(body.firmTypes, "firmTypes");
      await assertFirmTypesCanChange(firmTypes);
      addField("firm_types", JSON.stringify(firmTypes), "::jsonb");
    }
    if ("fileTypes" in body || "fileTypeGroups" in body) {
      const settings = await getSettings(user);
      const fileTypes =
        "fileTypes" in body ? readStringArray(body.fileTypes, "fileTypes") : settings.fileTypes;
      const fileTypeGroups =
        "fileTypeGroups" in body
          ? readFileTypeGroups(body.fileTypeGroups)
          : settings.fileTypeGroups;
      await reconcileFileTypeChanges(fileTypes, fileTypeGroups);
      if ("fileTypes" in body) addField("file_types", JSON.stringify(fileTypes), "::jsonb");
      if ("fileTypeGroups" in body)
        addField("file_type_groups", JSON.stringify(fileTypeGroups), "::jsonb");
    }
    if ("modes" in body) {
      const modes = readStringArray(body.modes, "modes");
      await assertModesCanChange(modes);
      addField("modes", JSON.stringify(modes), "::jsonb");
    }
    if ("gemBiddingModes" in body) {
      if (user.role !== "admin") {
        throw new HttpError(403, "Admin access required.");
      }
      const gemBiddingModes = normalizeGemBiddingModes(
        readStringArray(body.gemBiddingModes, "gemBiddingModes"),
      );
      await assertGemBiddingModesCanChange(gemBiddingModes);
      addField("gem_bidding_modes", JSON.stringify(gemBiddingModes), "::jsonb");
    }
    if ("mmgLiveEnabled" in body) addField("mmg_live_enabled", body.mmgLiveEnabled === true);
    if ("mmgLiveOptions" in body)
      addField(
        "mmg_live_options",
        JSON.stringify(readStringArray(body.mmgLiveOptions, "mmgLiveOptions")),
        "::jsonb",
      );
    if ("mmgSummaryFields" in body)
      addField(
        "mmg_summary_fields",
        JSON.stringify(readMmgSummaryFields(body.mmgSummaryFields)),
        "::jsonb",
      );
    if ("demandProcessingPresets" in body)
      addField(
        "demand_processing_presets",
        JSON.stringify(readArrayValue(body.demandProcessingPresets, "demandProcessingPresets")),
        "::jsonb",
      );
    if ("demandProcessingDayRanges" in body)
      addField(
        "demand_processing_day_ranges",
        JSON.stringify(readArrayValue(body.demandProcessingDayRanges, "demandProcessingDayRanges")),
        "::jsonb",
      );
    if ("bgReceiptDelayDays" in body)
      addField(
        "bg_receipt_delay_days",
        JSON.stringify(readBgReceiptDelayDays(body.bgReceiptDelayDays)),
        "::jsonb",
      );
    if ("specialFileMarkers" in body) {
      const specialFileMarkers = readSpecialFileMarkers(body.specialFileMarkers);
      await assertSpecialFileMarkersCanChange(specialFileMarkers);
      addField("special_file_markers", JSON.stringify(specialFileMarkers), "::jsonb");
    }
    if ("firmUniqueNoLabel" in body)
      addField("firm_unique_no_label", toDbText(body.firmUniqueNoLabel) || "Firm Unique No.");
    if ("firmRatingConfig" in body) {
      const firmRatingConfig = normalizeFirmRatingConfig(body.firmRatingConfig);
      for (const field of firmRatingConfig.fields) {
        if (Number(field.minValue) > Number(field.maxValue)) {
          throw new HttpError(
            400,
            `${field.label}: minimum rating value must not exceed maximum rating value.`,
          );
        }
      }
      addField(
        "firm_rating_config",
        JSON.stringify(firmRatingConfig),
        "::jsonb",
      );
    }
    if ("preSoDefaultSoOffsetDays" in body) {
      if (user.role !== "admin") {
        throw new HttpError(403, "Admin access required.");
      }
      addField(
        "pre_so_default_so_offset_days",
        readNonNegativeInteger(body.preSoDefaultSoOffsetDays, "Pre-S.O. default S.O. offset days"),
      );
    }
    if ("preSoDefaultPaymentOffsetDays" in body) {
      if (user.role !== "admin") {
        throw new HttpError(403, "Admin access required.");
      }
      addField(
        "pre_so_default_payment_offset_days",
        readNonNegativeInteger(
          body.preSoDefaultPaymentOffsetDays,
          "Pre-S.O. default payment offset days",
        ),
      );
    }
    if ("bgReturnOffsetDays" in body) {
      if (user.role !== "admin") {
        throw new HttpError(403, "Admin access required.");
      }
      addField(
        "bg_return_offset_days",
        readNonNegativeInteger(body.bgReturnOffsetDays, "BG return offset days"),
      );
    }
    if ("delayStatusDefaultDays" in body) {
      if (user.role !== "admin") {
        throw new HttpError(403, "Admin access required.");
      }
      addField(
        "delay_status_default_days",
        readNonNegativeInteger(body.delayStatusDefaultDays, "Delay Status default days"),
      );
    }
    if ("sharedQuickAccess" in body) {
      if (user.role !== "admin") throw new HttpError(403, "Admin access required.");
      addField(
        "shared_quick_access",
        JSON.stringify(readSharedQuickAccess(body.sharedQuickAccess)),
        "::jsonb",
      );
    }
    if ("quickEntryExcelPresets" in body) {
      if (user.role !== "admin") throw new HttpError(403, "Admin access required.");
      addField(
        "quick_entry_excel_presets",
        JSON.stringify(readQuickEntryExcelPresets(body.quickEntryExcelPresets)),
        "::jsonb",
      );
      addField("quick_entry_excel_presets_legacy_imported", true);
    } else if ("quickEntryExcelPresetsLegacyImported" in body) {
      if (user.role !== "admin") throw new HttpError(403, "Admin access required.");
      addField(
        "quick_entry_excel_presets_legacy_imported",
        body.quickEntryExcelPresetsLegacyImported === true,
      );
    }
    if ("tableFieldPresets" in body && user.role === "admin") {
      addField(
        "table_field_presets",
        JSON.stringify(readPresetArray(body.tableFieldPresets, "tableFieldPresets")),
        "::jsonb",
      );
    } else if ("tableFieldPresets" in body) {
      const personalPresets = readArrayValue(body.tableFieldPresets, "tableFieldPresets")
        .filter(
          (preset) =>
            preset &&
            typeof preset === "object" &&
            !Array.isArray(preset) &&
            (preset as Record<string, unknown>).owner !== "global",
        )
        .map(normalizePresetForStorage)
        .filter(Boolean);
      const ownerKey = presetOwnerKey(user);
      if (!ownerKey) throw new HttpError(400, "Preset owner is required.");
      await replaceUserTableFieldPresets(ownerKey, personalPresets);
    }
    if ("liveStatusLockedFields" in body) {
      const ownerKey = presetOwnerKey(user);
      if (!ownerKey) throw new HttpError(400, "Live status owner is required.");
      await replaceUserLiveStatusFields(
        ownerKey,
        readStringArray(body.liveStatusLockedFields, "liveStatusLockedFields"),
      );
    }
    if ("activeUserId" in body) addField("active_user_id", toDbText(body.activeUserId));

    if (
      !fields.length &&
      !("financialYearStatuses" in body) &&
      !("tcecCommittees" in body) &&
      !("valueThresholdLevels" in body) &&
      !("firmTypes" in body) &&
      !("fileTypes" in body) &&
      !("modes" in body) &&
      !("gemBiddingModes" in body) &&
      !("tableFieldPresets" in body) &&
      !("liveStatusLockedFields" in body) &&
      !("mmgSummaryFields" in body) &&
      !("theme" in body) &&
      !("themeTint" in body) &&
      !("appearancePreset" in body) &&
      !("fontFamily" in body) &&
      !("fontScale" in body) &&
      !("topRibbonColor" in body) &&
      !("topRibbonTextColor" in body) &&
      !("chartBarColor" in body) &&
      !("chartColorOrder" in body) &&
      !("addEditRibbonFields" in body) &&
      !("bgReceiptDelayDays" in body) &&
      !("specialFileMarkers" in body) &&
      !("firmUniqueNoLabel" in body) &&
      !("preSoDefaultSoOffsetDays" in body) &&
      !("preSoDefaultPaymentOffsetDays" in body) &&
      !("bgReturnOffsetDays" in body) &&
      !("delayStatusDefaultDays" in body) &&
      !("sharedQuickAccess" in body) &&
      !("quickEntryExcelPresets" in body) &&
      !("quickEntryExcelPresetsLegacyImported" in body)
    ) {
      throw new HttpError(400, "No settings fields provided.");
    }

    if (fields.length) {
      await pool.query(`update app_settings set ${fields.join(", ")} where id = true`, values);
    }
    clearSettingsCache();
    response.json({ settings: await getSettings(user) });
  }),
);

settingsRouter.post(
  "/financial-years",
  asyncHandler(async (request, response) => {
    const user = requireAuth(request as AuthRequest);
    if (user.role !== "admin") throw new HttpError(403, "Admin access required.");

    const body = requireObjectBody(request.body);
    const label = normalizeYearLabel(body.label, "label");
    if (!isFinancialYearLabel(label)) {
      throw new HttpError(400, "Financial year must be entered in YYYY-YY format, like 2026-27.");
    }
    validateContinuousFinancialYear(await loadFinancialYears(), label);
    const settings = await getSettings(user);
    const sourceYear = settings.setupYear || settings.financialYear;
    const client = await pool.connect();

    try {
      await client.query("begin");
      const created = await ensureFinancialYear(label, client);
      if (created) await copyYearSettings(sourceYear, label, client);

      if (body.select === true) {
        await client.query("update app_settings set setup_year = $1 where id = true", [label]);
      }

      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }

    clearSettingsCache();
    response.status(201).json({ settings: await getSettings(user) });
  }),
);

settingsRouter.get(
  "/financial-years/:label/usage-count",
  asyncHandler(async (request, response) => {
    const user = requireAuth(request as AuthRequest);
    if (user.role !== "admin" && user.role !== "sub_admin") {
      throw new HttpError(403, "Admin or Sub-admin access required.");
    }
    const label = requireParam(request.params.label, "label").trim();
    if (!label) throw new HttpError(400, "label is required.");
    const fileResult = await pool.query<{ count: string }>(
      `select count(*)
       from files f
       where f.year = $1
          or exists (
            select 1 from file_year_activity a
            where a.file_id = f.id and a.financial_year = $1
          )`,
      [label],
    );
    response.json({ count: Number(fileResult.rows[0]?.count ?? 0) });
  }),
);

settingsRouter.delete(
  "/financial-years/:label",
  asyncHandler(async (request, response) => {
    const user = requireAuth(request as AuthRequest);
    if (user.role !== "admin") throw new HttpError(403, "Admin access required.");

    const label = requireParam(request.params.label, "label").trim();
    if (!label) throw new HttpError(400, "label is required.");

    const settings = await getSettings(user);
    if (label === settings.financialYear) {
      throw new HttpError(400, "Current financial year cannot be deleted.");
    }
    const fileResult = await pool.query<{ count: string }>(
      `select count(*)
       from files f
       where f.year = $1
          or exists (
            select 1 from file_year_activity a
            where a.file_id = f.id and a.financial_year = $1
          )`,
      [label],
    );
    if (Number(fileResult.rows[0]?.count ?? 0) > 0) {
      throw new HttpError(400, "This year has files and cannot be deleted.");
    }

    await pool.query("delete from division_year_allocations where financial_year = $1", [label]);
    await pool.query("delete from tcec_committees where financial_year = $1", [label]);
    await pool.query("delete from value_threshold_levels where financial_year = $1", [label]);
    await pool.query("delete from financial_years where label = $1", [label]);
    if (label === settings.selectedYear) {
      await pool.query("update app_settings set selected_year = financial_year where id = true");
    }
    if (label === settings.setupYear) {
      await pool.query("update app_settings set setup_year = financial_year where id = true");
    }

    clearSettingsCache();
    response.json({ settings: await getSettings(user) });
  }),
);
