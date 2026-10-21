import { expect, test } from "@playwright/test";

import { pool } from "../../backend/src/db/pool.js";
import { deleteSession, saveUserSession } from "../../backend/src/utils/auth.js";

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const uniqueCode = `QA-FS-EXPECTED-SO-${suffix}`;
const username = `qa_fs_expected_so_${suffix.replace(/[^a-z0-9]/gi, "")}`;
const divisionName = "QA Financial Sanction";
const baseUrl = `http://localhost:${Number(process.env.PLAYWRIGHT_BACKEND_PORT ?? 3000)}`;

test("Financial Sanction Reports count and Search click-through include an expected TCEC S.O. with no row", async () => {
  await pool.query("insert into divisions (name) values ($1) on conflict (name) do nothing", [
    divisionName,
  ]);
  const user = await pool.query<{ id: string }>(
    `insert into app_users (name, username, role, password_hash, is_active)
     values ('Financial Sanction E2E', $1, 'admin', crypt($2, gen_salt('bf')), true)
     returning id`,
    [username, "unused-test-password"],
  );
  const userId = user.rows[0]?.id;
  if (!userId) throw new Error("Could not create the Financial Sanction E2E user.");
  const token = await saveUserSession(userId);
  const cookie = `recordkeeper_session=${encodeURIComponent(token)}`;
  let fileId: string | undefined;

  const api = async (path: string, method: "GET" | "POST", data?: unknown) => {
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

  try {
    const created = await api("/api/files", "POST", {
      uniqueCode,
      fileNo: uniqueCode,
      year: "2026-27",
      division: divisionName,
      fileType: "Goods & Services",
      fileTypeGroup: "goodsServices",
      demandDescription: uniqueCode,
      receivedDate: "2026-06-01",
      tcec: "Yes",
      biddingStageOver: "Yes",
      cncApprovalDate: "2026-09-01",
      currentMilestone: "Financial Sanction",
      noOfSo: "1",
      supplyOrders: [],
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    fileId = (created.body as { file: { id: string } }).file.id;

    const summaryQuery = new URLSearchParams({
      selectedYear: "__all_files__",
      delayDays: "5",
      delayMilestone: "financialSanction",
      division: "all",
    });
    const summary = await api(`/api/reports/summary?${summaryQuery}`, "GET");
    expect(summary.ok, JSON.stringify(summary.body)).toBe(true);
    const delayRows = (summary.body as { delayRows: Array<{ fileId: string }> }).delayRows;
    expect(delayRows.some((row) => row.fileId === fileId)).toBe(true);

    const searchQuery = new URLSearchParams({
      selectedYear: "__all_files__",
      dashboardFilter: "delayStatus:5:financialSanction",
      description: uniqueCode,
      pageSize: "100",
    });
    const search = await api(`/api/files/search?${searchQuery}`, "GET");
    expect(search.ok, JSON.stringify(search.body)).toBe(true);
    const searchFiles = (search.body as { files: Array<{ id: string }> }).files;
    expect(searchFiles.some((file) => file.id === fileId)).toBe(true);
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
