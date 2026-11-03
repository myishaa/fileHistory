import { pool } from "../db/pool.js";
import { ensureUserPermissionSchema } from "./auth.js";
import { HttpError } from "./http.js";

const maxDeletionPasswordLength = 128;

function readDeletionPassword(value: unknown, fieldName = "Deletion password") {
  if (typeof value !== "string" || !value.trim()) {
    throw new HttpError(400, `${fieldName} is required.`);
  }
  if (value.length > maxDeletionPasswordLength) {
    throw new HttpError(400, `${fieldName} must be ${maxDeletionPasswordLength} characters or fewer.`);
  }
  return value;
}

export async function deletionPasswordIsConfigured(userId: string) {
  await ensureUserPermissionSchema();
  const result = await pool.query<{ configured: boolean }>(
    `select deletion_password_hash <> '' as configured
     from app_users
     where id::text = $1 and is_active = true and archived_at is null`,
    [userId],
  );
  return result.rows[0]?.configured ?? false;
}

export async function saveDeletionPassword(
  userId: string,
  passwordValue: unknown,
  confirmationValue: unknown,
) {
  const password = readDeletionPassword(passwordValue);
  const confirmation = readDeletionPassword(confirmationValue, "Reconfirmed deletion password");
  if (password !== confirmation) {
    throw new HttpError(400, "Deletion password and reconfirmation do not match.");
  }

  await ensureUserPermissionSchema();
  const result = await pool.query(
    `update app_users
     set deletion_password_hash = crypt($2, gen_salt('bf'))
     where id::text = $1 and is_active = true and archived_at is null`,
    [userId, password],
  );
  if (result.rowCount === 0) {
    throw new HttpError(403, "A personal deletion password is unavailable for this account.");
  }
}

export async function verifyDeletionPassword(userId: string, passwordValue: unknown) {
  const password = readDeletionPassword(passwordValue);
  await ensureUserPermissionSchema();
  const result = await pool.query<{ configured: boolean; valid: boolean }>(
    `select
       deletion_password_hash <> '' as configured,
       deletion_password_hash <> ''
         and deletion_password_hash = crypt($2, deletion_password_hash) as valid
     from app_users
     where id::text = $1 and is_active = true and archived_at is null`,
    [userId, password],
  );
  if (!result.rows[0]?.configured) {
    throw new HttpError(
      400,
      "Set your personal deletion password in Settings > User before deleting records.",
    );
  }
  if (!result.rows[0].valid) throw new HttpError(403, "Incorrect deletion password.");
}
