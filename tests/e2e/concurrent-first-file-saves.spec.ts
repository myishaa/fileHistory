import { expect, test } from "@playwright/test";

import { pool } from "../../backend/src/db/pool.js";
import { deleteSession, saveUserSession } from "../../backend/src/utils/auth.js";

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const uniqueCodes = [1, 2].map((index) => `QA-CONCURRENT-FIRST-SAVE-${suffix}-${index}`);
const username = `qa_concurrent_save_${suffix.replace(/[^a-z0-9]/gi, "")}`;
const divisionName = "QA Concurrent Save";
const baseUrl = `http://localhost:${Number(process.env.PLAYWRIGHT_BACKEND_PORT ?? 3000)}`;

test("concurrent first file saves do not run schema DDL inside transactions", async () => {
  const columns = await pool.query<{ table_name: string; column_name: string }>(
    `select column_name from information_schema.columns
     where table_schema = current_schema()
       and table_name in ('supply_orders', 'app_settings')`,
  );
  const columnNames = new Set(
    columns.rows.map(({ table_name, column_name }) => `${table_name}.${column_name}`),
  );
  for (const column of [
    "supply_orders.bill_return_cycles",
    "supply_orders.no_further_action_date",
    "supply_orders.job_completion_date",
    "supply_orders.actual_job_completion_date",
    "supply_orders.supplementary_bills",
    "supply_orders.include_in_payment_timing",
    "app_settings.bg_return_offset_days",
  ]) {
    expect(columnNames.has(column), `apply migrations through 083; missing ${column}`).toBe(true);
  }

  await pool.query("insert into divisions (name) values ($1) on conflict (name) do nothing", [
    divisionName,
  ]);
  const user = await pool.query<{ id: string }>(
    `insert into app_users (name, username, role, password_hash, is_active)
     values ('Concurrent Save E2E', $1, 'admin', crypt($2, gen_salt('bf')), true)
     returning id`,
    [username, "unused-test-password"],
  );
  const userId = user.rows[0]?.id;
  if (!userId) throw new Error("Could not create the concurrent-save test user.");
  const token = await saveUserSession(userId);
  const cookie = `recordkeeper_session=${encodeURIComponent(token)}`;
  const payloadFor = (uniqueCode: string) => ({
    uniqueCode,
    fileNo: uniqueCode,
    year: "2026-27",
    division: divisionName,
    fileType: "Goods & Services",
    fileTypeGroup: "goodsServices",
    demandDescription: uniqueCode,
    receivedDate: "2026-06-01",
    ir: "No",
    gem: "No",
    mode: "PBM",
    supplyOrders: [{ soNo: `${uniqueCode}-SO`, soDate: "2026-06-10", soValueCapital: "1000" }],
  });

  try {
    const results = await Promise.all(
      uniqueCodes.map((uniqueCode) =>
        fetch(`${baseUrl}/api/files`, {
          method: "POST",
          headers: { cookie, "content-type": "application/json" },
          body: JSON.stringify(payloadFor(uniqueCode)),
          signal: AbortSignal.timeout(20_000),
        }),
      ),
    );
    const bodies = await Promise.all(results.map((response) => response.json()));
    expect(results.map((response) => response.status), JSON.stringify(bodies)).toEqual([201, 201]);
  } finally {
    await pool.query("delete from files where unique_code = any($1::text[])", [uniqueCodes]);
    await deleteSession(token);
    await pool.query("delete from app_users where id = $1", [userId]);
    await pool.query(
      `delete from divisions where name = $1
       and not exists (select 1 from files where division_id = divisions.id)`,
      [divisionName],
    );
  }
});
