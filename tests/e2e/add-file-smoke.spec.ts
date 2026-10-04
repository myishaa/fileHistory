import { expect, test } from "@playwright/test";

import { pool } from "../../backend/src/db/pool.js";
import { deleteSession, saveUserSession } from "../../backend/src/utils/auth.js";

const description = "QA-PLAYWRIGHT-SMOKE add-file save";

test("saves a new file from the current Add File form", async ({ page }) => {
  const user = await pool.query<{ id: string }>(
    "select id from app_users where username = $1 and is_active = true",
    ["dashboard_audit"],
  );
  const userId = user.rows[0]?.id;
  if (!userId) throw new Error("Audit admin is missing from the isolated database.");
  const token = await saveUserSession(userId);
  try {
    await page.context().addCookies([
      {
        name: "recordkeeper_session",
        value: token,
        domain: "localhost",
        path: "/",
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
    await page.goto("/add");
    await page.getByTestId("add-section-file-details").click();
    await page.getByTestId("add-field-division").fill("trial");
    await page.getByTestId("add-field-division").press("Enter");
    await expect(page.getByTestId("add-field-uniqueCode")).not.toHaveValue("");
    await page.getByTestId("add-field-demandDescription").fill(description);

    const responsePromise = page.waitForResponse(
      (response) => response.url().endsWith("/api/files") && response.request().method() === "POST",
    );
    await page.getByTestId("add-save-file-details").click();
    const response = await responsePromise;
    expect(response.ok()).toBeTruthy();

    const saved = await pool.query<{ id: string }>(
      "select id from files where demand_description = $1",
      [description],
    );
    expect(saved.rows).toHaveLength(1);
  } finally {
    await pool.query("delete from files where demand_description = $1", [description]);
    await deleteSession(token);
  }
});
