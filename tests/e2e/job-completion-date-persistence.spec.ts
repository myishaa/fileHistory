import { expect, test } from "@playwright/test";

import { pool } from "../../backend/src/db/pool.js";
import { deleteSession, saveUserSession } from "../../backend/src/utils/auth.js";

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const uniqueCode = `QA-JOB-COMPLETION-${suffix}`;
const divisionName = "QA Job Completion";
const baseUrl = `http://localhost:${Number(process.env.PLAYWRIGHT_BACKEND_PORT ?? 3000)}`;

test("create and update persist received and actual job-completion dates", async () => {
  const columnCheck = await pool.query<{ exists: boolean }>(
    `select exists (
       select 1 from information_schema.columns
       where table_schema = current_schema()
         and table_name = 'supply_orders'
         and column_name = 'job_completion_date'
     ) as exists`,
  );
  expect(columnCheck.rows[0]?.exists, "apply database migrations through 083 first").toBe(true);

  await pool.query(
    `insert into divisions (name) values ($1)
     on conflict (name) do nothing`,
    [divisionName],
  );
  const user = await pool.query<{ id: string }>(
    `insert into app_users (name, username, role, password_hash, is_active)
     values ('Job Completion E2E', $1, 'admin', crypt($2, gen_salt('bf')), true)
     on conflict (username) do update set role = 'admin', is_active = true
     returning id`,
    [`qa_job_completion_${suffix}`, "unused-test-password"],
  );
  const userId = user.rows[0]?.id;
  if (!userId) throw new Error("Could not create the Job Completion E2E user.");
  const token = await saveUserSession(userId);
  const cookie = `recordkeeper_session=${encodeURIComponent(token)}`;
  let fileId: string | undefined;

  const payload = {
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
    supplyOrders: [
      {
        soNo: `${uniqueCode}-SO`,
        soDate: "2026-06-10",
        soValueCapital: "1000",
        firm: "QA Job Completion Supplier",
        jobCompletionDate: "2026-07-10",
        actualJobCompletionDate: "2026-07-08",
      },
    ],
  };

  try {
    const api = async (path: string, method: "GET" | "POST" | "PATCH", data?: unknown) => {
      const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers: {
          cookie,
          ...(data ? { "content-type": "application/json" } : {}),
        },
        ...(data ? { body: JSON.stringify(data) } : {}),
      });
      return { status: response.status, ok: response.ok, body: await response.json() };
    };

    const preflight = await api("/api/files?year=__all_files__", "GET");
    expect(preflight.ok, JSON.stringify(preflight.body)).toBe(true);

    const created = await api("/api/files", "POST", payload);
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const createdBody = created.body as { file: { id: string; supplyOrders: unknown[] } };
    fileId = createdBody.file.id as string;
    expect(createdBody.file.supplyOrders[0]).toMatchObject({
      jobCompletionDate: "2026-07-10",
      actualJobCompletionDate: "2026-07-08",
    });

    const updatedPayload = {
      ...payload,
      supplyOrders: [
        {
          ...payload.supplyOrders[0],
          jobCompletionDate: "2026-07-20",
          actualJobCompletionDate: "2026-07-18",
        },
      ],
    };
    const updated = await api(`/api/files/${fileId}`, "PATCH", updatedPayload);
    expect(updated.ok, JSON.stringify(updated.body)).toBe(true);
    const updatedBody = updated.body as { file: { supplyOrders: unknown[] } };
    expect(updatedBody.file.supplyOrders[0]).toMatchObject({
      jobCompletionDate: "2026-07-20",
      actualJobCompletionDate: "2026-07-18",
    });
  } finally {
    if (fileId) await pool.query("delete from files where id = $1", [fileId]);
    await deleteSession(token);
    await pool.query("delete from app_users where id = $1", [userId]);
    await pool.query(
      `delete from divisions where name = $1
       and not exists (select 1 from files where division_id = divisions.id)`,
      [divisionName],
    );
  }
});
