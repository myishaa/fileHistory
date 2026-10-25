import pg from "pg";

process.env.TZ = "Asia/Kolkata";

const { Pool } = pg;

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is required for the backend server.");
}

export const pool = new Pool({
  connectionString,
  options: "-c timezone=Asia/Kolkata",
  max: 30,
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30000,
});

export async function checkDatabaseConnection() {
  const result = await pool.query<{ ok: number; now: Date }>("select 1 as ok, now() as now");
  return result.rows[0];
}
