/**
 * Exercises destructive Settings paths against a disposable database only.
 * It intentionally restores the encrypted backup before exiting.
 */
const baseUrl = process.env.BACKEND_URL ?? "http://127.0.0.1:3010";
const username = process.env.AUDIT_USERNAME ?? "dashboard_audit";
const loginPassword = process.env.AUDIT_PASSWORD ?? "dashboard_audit123";
const backupPassword = process.env.QA_BACKUP_PASSWORD ?? "QaAuditBackup#2026";

function fail(message) {
  throw new Error(message);
}

async function request(path, { token, method = "GET", body } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(token ? { cookie: `recordkeeper_session=${encodeURIComponent(token)}` } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const payload = await response.json().catch(() => undefined);
  if (!response.ok) fail(`${method} ${path} returned ${response.status}: ${payload?.error ?? "unknown error"}`);
  return { payload, headers: response.headers };
}

async function main() {
  if (process.env.QA_DISPOSABLE_DATABASE !== "1") {
    fail(
      "Refusing destructive Settings audit. Set QA_DISPOSABLE_DATABASE=1 and point BACKEND_URL at a disposable QA database.",
    );
  }
  if (process.env.NODE_ENV === "production") {
    fail("Refusing destructive Settings audit while NODE_ENV=production.");
  }

  const login = await request("/api/auth/login", {
    method: "POST",
    body: { username, password: loginPassword },
  });
  const cookie = login.headers.get("set-cookie") ?? "";
  const token = decodeURIComponent(cookie.match(/recordkeeper_session=([^;]+)/)?.[1] ?? "");
  if (!token) fail("Login did not return a session cookie.");

  const before = (await request("/api/settings", { token })).payload.settings;
  const backupResponse = await request("/api/settings/protected-backup/export", {
    token,
    method: "POST",
    body: { password: backupPassword },
  });
  const backup = backupResponse.payload;
  if (!backup || typeof backup !== "object") fail("Protected backup did not return an envelope.");
  const contentDisposition = backupResponse.headers.get("content-disposition") ?? "";
  if (!/recordkeeper-backup-.*\.rbk/.test(contentDisposition)) {
    fail(`Backup filename header is invalid: ${contentDisposition}`);
  }

  const currentYear = before.financialYear;
  const targetYear = (before.financialYears ?? []).find((year) => year !== currentYear);
  if (!targetYear) fail("No non-current financial year exists for archive/recovery test.");

  // Restricted roles now require an explicit division assignment.  Use the
  // first active division only in the disposable QA user created below; this
  // keeps the audit aligned with production validation without broadening
  // the test user's scope.
  // The API serializes an unarchived date as an empty string (not null), and
  // a copied QA database may not have an allocation row for the selected FY.
  // Include inactive divisions for this isolated permission round-trip and
  // select any non-archived division; the test user is never used in live data.
  const divisions =
    (await request("/api/divisions?includeInactive=true", { token })).payload?.divisions ?? [];
  const qaDivisionId = divisions.find((division) => !division?.archivedAt)?.id;
  if (!qaDivisionId) fail("No non-archived division exists for the QA permission test user.");

  await request(`/api/settings/financial-years/${encodeURIComponent(targetYear)}/archive`, {
    token,
    method: "PATCH",
    body: { archived: true },
  });
  const archived = (await request("/api/settings", { token })).payload.settings;
  const isArchived = (settings, year) =>
    (settings.financialYearStatuses ?? []).some((entry) => entry?.label === year && entry?.archived === true);
  if (!isArchived(archived, targetYear)) {
    fail(`${targetYear} was not archived in the QA database.`);
  }

  const restored = await request("/api/settings/protected-backup/restore", {
    token,
    method: "POST",
    body: { password: backupPassword, backup },
  });
  if (restored.payload?.restored !== true) fail("Protected-backup restore did not confirm success.");

  const after = (await request("/api/settings", { token })).payload.settings;
  if (JSON.stringify(before.financialYears ?? []) !== JSON.stringify(after.financialYears ?? [])) {
    fail("Financial-year list differs after backup restore.");
  }
  if (JSON.stringify(before.financialYearStatuses ?? []) !== JSON.stringify(after.financialYearStatuses ?? [])) {
    fail("Archived financial-year state differs after backup restore.");
  }
  if (before.financialYear !== after.financialYear) fail("Current financial year differs after backup restore.");

  // A restore must leave every identity/serial sequence usable. Exporting a
  // second backup immediately exercises protected_backup_log.id, which used
  // to fail with a duplicate-key error after the first restore.
  const repeatBackupResponse = await request("/api/settings/protected-backup/export", {
    token,
    method: "POST",
    body: { password: backupPassword },
  });
  const repeatContentDisposition = repeatBackupResponse.headers.get("content-disposition") ?? "";
  if (!repeatBackupResponse.payload || !/recordkeeper-backup-.*\.rbk/.test(repeatContentDisposition)) {
    fail("Backup export after restore did not complete successfully.");
  }

  // Exercise user permission changes and reversible delete/restore in the
  // disposable database.  The user is left restored and active so the QA
  // database remains reusable; permanent deletion is intentionally not part
  // of this repeatable audit unless an operator runs it separately.
  const qaUsername = `qa_settings_audit_${Date.now()}`;
  const createdUser = await request("/api/users", {
    token,
    method: "POST",
    body: {
      name: "QA Settings Audit User",
      username: qaUsername,
      role: "editor",
      password: "QaSettingsAudit#2026",
      divisionIds: [qaDivisionId],
    },
  });
  const userId = createdUser.payload?.user?.id;
  if (!userId) fail("QA permission test user was not created.");
  const permissionBefore = createdUser.payload.user;
  const changedRole = "viewer";
  const changed = await request(`/api/users/${encodeURIComponent(userId)}`, {
    token,
    method: "PATCH",
    body: { role: changedRole },
  });
  if (changed.payload?.user?.role !== changedRole) fail("Permission role update was not persisted.");
  const archivedUser = await request(`/api/users/${encodeURIComponent(userId)}`, {
    token,
    method: "DELETE",
  });
  if (archivedUser.payload?.archived !== true) fail("User archive/delete action was not persisted.");
  const restoredUser = await request(`/api/users/archive/${encodeURIComponent(userId)}/restore`, {
    token,
    method: "POST",
  });
  if (restoredUser.payload?.user?.isActive === false) {
    fail("User restore did not reactivate the QA user.");
  }

  process.stdout.write(`${JSON.stringify({
    database: "QA only",
    backupCreated: true,
    archiveMutation: { year: targetYear, observed: true },
    backupRestore: { restored: true, rows: restored.payload.rows, tables: restored.payload.tables },
    repeatBackupAfterRestore: { created: true },
    stateRestored: true,
    settingsWrites: {
      permissionRoleChange: { userId, from: permissionBefore?.role, to: changedRole },
      archiveAndRestore: { userId, restored: true },
    },
  }, null, 2)}\n`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
