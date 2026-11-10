import assert from "node:assert/strict";
import { chromium, request as playwrightRequest } from "playwright";

const apiBaseUrl = process.env.QA_AUDIT_API_URL ?? "http://localhost:3002";
const frontendUrl = process.env.QA_AUDIT_FRONTEND_URL ?? "http://localhost:8082";
const adminUsername = process.env.QA_AUDIT_ADMIN_USERNAME ?? "dashboard_audit";
const adminPassword = process.env.QA_AUDIT_ADMIN_PASSWORD ?? "dashboard_audit123";
const password = process.env.QA_AUDIT_USER_PASSWORD ?? "QaRoleAudit#2026";
const qaDatabase = process.env.QA_AUDIT_DATABASE ?? "recordkeeper_qa_full_audit_20261102";
// Master-data endpoints intentionally hide values carrying the reserved
// standalone "qa" marker. Keep this audit's temporary user names distinct,
// but use a neutral prefix for indentors and firms so their create/read
// round-trips exercise the real response path.
const prefix = `settings_role_audit_${Date.now()}`;

const expectedSettings = {
  admin: [
    "UI theme",
    "Notice board",
    "Quick Entry Excel",
    "User",
    "Workspace",
    "Offset days setting",
    "Year Setup",
    "MMG Summary",
    "Demand Processing Analysis Presets",
    "Divisions",
    "Indentors",
    "Firm Database",
    "Firm Rating",
    "File Types",
    "Modes",
    "GeM Bidding Modes",
    "Firm Types",
    "File Markers",
    "TCEC Committee",
    "Value thresholds",
    "BG receipt delay",
    "Anomaly Control",
    "Milestones",
    "Preset table fields",
    "Authorised users",
    "IP Access",
    "Archive",
    "Protected backup",
  ],
  sub_admin: ["UI theme", "Notice board", "User", "Indentors", "Firm Database", "Preset table fields", "Archive"],
  editor: ["UI theme", "Notice board", "User", "Indentors", "Firm Database", "Preset table fields"],
  division_user: ["UI theme", "Notice board", "Indentors", "Preset table fields"],
  viewer: ["UI theme", "Notice board", "Indentors", "Preset table fields"],
  universal_viewer: ["UI theme", "Notice board", "Offset days setting", "Preset table fields", "User"],
};

async function json(response, label) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`${label}: ${response.status} ${body?.error ?? JSON.stringify(body)}`);
  }
  return body;
}

async function loginApi(api, username, loginPassword) {
  await json(await api.post("/api/auth/login", { data: { username, password: loginPassword } }), `login ${username}`);
}

async function createUser(api, { username, role, divisionIds, cashOutgoEditScope = "none" }) {
  const body = await json(
    await api.post("/api/users", {
      data: {
        name: `Settings role audit ${role}`,
        username,
        role,
        password,
        divisionIds,
        cashOutgoEditScope,
      },
    }),
    `create ${role}`,
  );
  assert.ok(body.user?.id, `Created ${role} user should have an id.`);
  return body.user;
}

async function loginBrowser(browser, username) {
  const api = await playwrightRequest.newContext({ baseURL: apiBaseUrl });
  await loginApi(api, username, passwordFor(username));
  const storageState = await api.storageState();
  await api.dispose();
  const context = await browser.newContext();
  await context.addCookies(storageState.cookies);
  const page = await context.newPage();
  await page.goto(`${frontendUrl}/quick-entry`, { waitUntil: "networkidle" });
  return { context, page };
}

async function dismissUrgentDialog(page) {
  const urgentDialog = page.getByRole("dialog", { name: "Urgent reminders and messages" });
  if (await urgentDialog.isVisible().catch(() => false)) {
    const close = urgentDialog.getByRole("button", { name: /close/i });
    if (await close.count()) await close.first().click();
  }
}

const credentials = new Map([[adminUsername, adminPassword]]);
function passwordFor(username) {
  return credentials.get(username) ?? password;
}

async function visibleSettingsLabels(page) {
  await page.goto(`${frontendUrl}/settings`, { waitUntil: "networkidle" });
  await dismissUrgentDialog(page);
  const tabButtons = page.locator('[aria-label="Settings sections"] button');
  const menuButtons = page.locator("aside button");
  if (!(await tabButtons.count())) {
    const groupButtons = page.locator('aside button[aria-expanded]');
    const discovered = new Set();
    for (let index = 0; index < await groupButtons.count(); index += 1) {
      await groupButtons.nth(index).click();
      for (const label of await menuButtons.allTextContents()) discovered.add(label.trim());
    }
    return [...discovered].filter(Boolean);
  }
  const labels = (await tabButtons.count())
    ? await tabButtons.allTextContents()
    : await menuButtons.allTextContents();
  return labels.map((label) => label.trim()).filter(Boolean);
}

async function checkSettingsDraftPersistence(browser, user) {
  const { context, page } = await loginBrowser(browser, user.username);
  const verifyApi = await playwrightRequest.newContext({ baseURL: apiBaseUrl });
  let originalPresetSettings;
  try {
    await loginApi(verifyApi, user.username, passwordFor(user.username));
    const beforeSettings = (await json(await verifyApi.get("/api/settings"), `read ${user.role} settings`)).settings;
    originalPresetSettings = beforeSettings.tableFieldPresets;
    await page.goto(`${frontendUrl}/settings?section=presets`, { waitUntil: "networkidle" });
    await dismissUrgentDialog(page);
    const presetSectionButton = page.locator('button:visible').filter({ hasText: /^Preset table fields$/ }).first();
    if (await presetSectionButton.count()) await presetSectionButton.click();
    await page.getByRole("heading", { name: "Preset table fields", exact: true }).waitFor({ state: "visible", timeout: 10_000 });
    const editButton = page.getByRole("button", { name: "Edit", exact: true });
    if (await editButton.count()) {
      await editButton.click();
      const prompt = page.locator('[role="presentation"]').last();
      await prompt.locator('input[type="password"]').fill(passwordFor(user.username));
      await prompt.getByRole("button", { name: "Confirm", exact: true }).click();
    }
    const addPresetButton = page.getByRole("button", { name: "Add preset", exact: true });
    if (user.role !== "admin" && await addPresetButton.count()) await addPresetButton.click();
    const preset = page
      .locator("label")
      .filter({ hasText: "D.P. Start Date" })
      .locator('input[type="checkbox"]')
      .last();
    if (!(await preset.count())) throw new Error(`Preset control is missing for ${user.role}.`);
    const before = await preset.isChecked();
    await preset.setChecked(!before);
    await page.getByRole("button", { name: "Save changes", exact: true }).click();
    await page.waitForTimeout(600);
    const afterSettings = (await json(await verifyApi.get("/api/settings"), `re-read ${user.role} settings`)).settings;
    const matchingPreset = (afterSettings.tableFieldPresets ?? []).find((item) =>
      user.role === "admin" ? item.owner === "global" : item.owner === "personal" && item.ownerUserId === user.id,
    );
    assert.ok(matchingPreset, `${user.role} preset should persist in the settings response.`);
    const after = matchingPreset.fieldKeys.includes("deliveryPeriodStartDate");
    assert.equal(
      after,
      !before,
      `${user.role} preset change should persist through the API.`,
    );
    if (user.role === "admin") {
      await json(
        await verifyApi.patch("/api/settings", { data: { tableFieldPresets: beforeSettings.tableFieldPresets } }),
        "restore admin preset settings",
      );
    }
    return { before, after };
  } finally {
    if (user.role === "admin" && originalPresetSettings) {
      await verifyApi.patch("/api/settings", { data: { tableFieldPresets: originalPresetSettings } }).catch(() => undefined);
    }
    await context.close();
    await verifyApi.dispose();
  }
}

async function checkSettingsSectionRendering(browser, user) {
  const { context, page } = await loginBrowser(browser, user.username);
  try {
    const expected = expectedSettings[user.role];
    await page.goto(`${frontendUrl}/settings`, { waitUntil: "networkidle" });
    await dismissUrgentDialog(page);
    const tabButtons = page.locator('[aria-label="Settings sections"] button');
    const rendered = [];

    if (await tabButtons.count()) {
      for (const label of expected) {
        const button = page.getByRole("tab", { name: label, exact: true });
        assert.equal(await button.count(), 1, `${user.role} Settings tab ${label} should be unique.`);
        await button.click();
        await page.waitForTimeout(100);
        assert.equal(
          await page.locator('[role="alert"]:visible').count(),
          0,
          `${user.role} Settings tab ${label} should not render an alert.`,
        );
        assert.equal(await button.getAttribute("data-state"), "active", `${label} should be active after click.`);
        rendered.push(label);
      }
    } else {
      const groups = page.locator('aside button[aria-expanded]');
      for (let index = 0; index < await groups.count(); index += 1) {
        if ((await groups.nth(index).getAttribute("aria-expanded")) !== "true") {
          await groups.nth(index).click();
        }
        for (const label of expected) {
          const button = page.getByRole("button", { name: label, exact: true });
          if (!(await button.count())) continue;
          assert.equal(await button.count(), 1, `${user.role} Settings section ${label} should be unique.`);
          await button.click();
          await page.waitForTimeout(100);
          assert.equal(
            await page.locator('[role="alert"]:visible').count(),
            0,
            `${user.role} Settings section ${label} should not render an alert.`,
          );
          assert.match(
            String(await button.getAttribute("class")),
            /bg-primary/,
            `${label} should be highlighted after click.`,
          );
          rendered.push(label);
        }
      }
      assert.deepEqual([...new Set(rendered)].sort(), [...expected].sort(), `${user.role} Settings sections should all render.`);
    }
    return rendered;
  } finally {
    await context.close();
  }
}

async function checkNavigationVisibility(browser, user) {
  const { context, page } = await loginBrowser(browser, user.username);
  try {
    await page.goto(`${frontendUrl}/quick-entry`, { waitUntil: "networkidle" });
    await dismissUrgentDialog(page);
    const labels = (await page.locator("header nav a").allTextContents())
      .map((label) => label.trim())
      .filter(Boolean);
    const expected = ["Search Files", "Quick Entry", "Dashboard", "Reports", "Settings"];
    if (["admin", "sub_admin", "editor"].includes(user.role)) expected.unshift("Add File");
    for (const label of expected) {
      assert.ok(labels.includes(label), `${user.role} should see ${label} in the main navigation.`);
    }
    if (!["admin", "sub_admin", "editor"].includes(user.role)) {
      assert.ok(!labels.includes("Add File"), `${user.role} must not see Add File in the main navigation.`);
    }
    return { role: user.role, username: user.username, visible: labels };
  } finally {
    await context.close();
  }
}

async function checkCoreCapabilityMatrix(api, users, divisionId) {
  const admin = users.find((user) => user.role === "admin");
  const divisionUser = users.find((user) => user.role === "division_user");
  assert.ok(admin && divisionUser, "Capability audit users are missing.");
  const adminApi = await playwrightRequest.newContext({ baseURL: apiBaseUrl });
  const result = {
    navigation: [],
    divisions: [],
    users: [],
    files: [],
    archives: [],
    messages: [],
    urgentMessages: [],
    indentors: [],
    firms: [],
  };
  const createdIndentors = [];
  const createdFirms = [];
  try {
    await loginApi(adminApi, admin.username, password);
    const adminDivisionsBody = await json(
      await adminApi.get("/api/divisions?includeInactive=true"),
      "load admin division scope",
    );
    const expectedAdminDivisionCount = Array.isArray(adminDivisionsBody.divisions)
      ? adminDivisionsBody.divisions.length
      : 0;
    assert.ok(expectedAdminDivisionCount > 0, "Admin must see at least one visible division.");
    const filesBody = await json(await adminApi.get("/api/files?year=all"), "load QA files");
    const targetFile = filesBody.files?.find((file) => file.divisionId === divisionId) ?? filesBody.files?.[0];
    assert.ok(targetFile?.id, "QA database must contain a file for capability probes.");

    for (const user of users) {
      const roleApi = await playwrightRequest.newContext({ baseURL: apiBaseUrl });
      try {
        await loginApi(roleApi, user.username, password);
        const divisionResponse = await roleApi.get("/api/divisions?includeInactive=true");
        const divisionBody = await json(divisionResponse, `${user.role} divisions`);
        const divisionCount = Array.isArray(divisionBody.divisions) ? divisionBody.divisions.length : 0;
        const expectedDivisionCount = user.role === "admin" ? expectedAdminDivisionCount : 1;
        assert.equal(divisionCount, expectedDivisionCount, `${user.role} division scope mismatch.`);
        result.divisions.push({ role: user.role, count: divisionCount });

        const usersResponse = await roleApi.get("/api/users");
        const canViewUsers = ["admin", "sub_admin"].includes(user.role);
        assert.equal(usersResponse.status(), canViewUsers ? 200 : 403, `${user.role} user-list boundary mismatch.`);
        const createUserResponse = await roleApi.post("/api/users", { data: {} });
        assert.equal(createUserResponse.status(), user.role === "admin" ? 400 : 403, `${user.role} user-create boundary mismatch.`);
        result.users.push({ role: user.role, listStatus: usersResponse.status(), createStatus: createUserResponse.status() });

        const fileCreateResponse = await roleApi.post("/api/files", { data: {} });
        const canEditFiles = ["admin", "sub_admin", "editor"].includes(user.role);
        assert.equal(fileCreateResponse.status(), canEditFiles ? 400 : 403, `${user.role} file-create boundary mismatch.`);
        result.files.push({ role: user.role, createStatus: fileCreateResponse.status() });

        const archiveResponse = await roleApi.get("/api/files/archive/list");
        const canArchive = ["admin", "sub_admin", "editor"].includes(user.role);
        assert.equal(archiveResponse.status(), canArchive ? 200 : 403, `${user.role} archive boundary mismatch.`);
        result.archives.push({ role: user.role, listStatus: archiveResponse.status() });

        const recipientsResponse = await roleApi.get(`/api/messages/recipients?divisionId=${encodeURIComponent(divisionId)}`);
        const canUseMmgMessaging = ["admin", "sub_admin", "editor"].includes(user.role);
        assert.equal(recipientsResponse.status(), canUseMmgMessaging ? 200 : 403, `${user.role} recipient boundary mismatch.`);

        const messagePayload = {
          fileId: targetFile.id,
          section: "QA role capability audit",
          text: "QA role capability audit message",
          ...(canUseMmgMessaging ? { recipientUserId: divisionUser.id } : {}),
        };
        const messageResponse = await roleApi.post("/api/messages", { data: messagePayload });
        const canSendFileMessage = ["admin", "sub_admin", "editor", "division_user"].includes(user.role);
        const messageResponseText = await messageResponse.text();
        assert.equal(
          messageResponse.status(),
          canSendFileMessage ? 201 : 403,
          `${user.role} file-message boundary mismatch: ${messageResponseText}`,
        );
        let createdMessageId;
        if (messageResponse.status() === 201) {
          const messageBody = JSON.parse(messageResponseText);
          createdMessageId = messageBody.message?.id;
          assert.ok(createdMessageId, `${user.role} message should return an id.`);
          const resolveResponse = await roleApi.post(`/api/messages/${createdMessageId}/resolve`, { data: {} });
          const canResolve = ["admin", "sub_admin", "editor"].includes(user.role);
          assert.equal(resolveResponse.status(), canResolve ? 200 : 403, `${user.role} message-resolve boundary mismatch.`);
          const deleteResponse = await roleApi.delete(`/api/messages/${createdMessageId}`);
          assert.equal(deleteResponse.status(), 200, `${user.role} should delete its own QA message.`);
        }
        result.messages.push({
          role: user.role,
          recipientsStatus: recipientsResponse.status(),
          createStatus: messageResponse.status(),
          resolveStatus: createdMessageId ? (canUseMmgMessaging ? 200 : 403) : undefined,
        });

        const urgentAdminResponse = await roleApi.post("/api/urgent-messages", {
          data: {
            kind: "admin",
            body: "QA admin urgent message",
            audience: user.role === "sub_admin" ? "divisions" : "all_users",
            ...(user.role === "sub_admin" ? { recipientDivisionIds: [divisionId] } : {}),
          },
        });
        const canSendAdminUrgent = ["admin", "sub_admin"].includes(user.role);
        assert.equal(urgentAdminResponse.status(), canSendAdminUrgent ? 201 : 403, `${user.role} admin-urgent boundary mismatch.`);
        if (urgentAdminResponse.status() === 201) {
          const urgentBody = await urgentAdminResponse.json();
          const urgentId = urgentBody.message?.id;
          assert.ok(urgentId, `${user.role} urgent message should return an id.`);
          const deleteUrgentResponse = await roleApi.delete(`/api/urgent-messages/${urgentId}`);
          assert.equal(deleteUrgentResponse.status(), 200, `${user.role} should delete its own QA urgent message.`);
        }
        const urgentReminderResponse = await roleApi.post("/api/urgent-messages", {
          data: { kind: "reminder", body: "QA personal reminder" },
        });
        const canSendReminder = ["admin", "sub_admin", "editor", "division_user"].includes(user.role);
        assert.equal(urgentReminderResponse.status(), canSendReminder ? 201 : 403, `${user.role} reminder boundary mismatch.`);
        if (urgentReminderResponse.status() === 201) {
          const urgentBody = await urgentReminderResponse.json();
          const urgentId = urgentBody.message?.id;
          assert.ok(urgentId, `${user.role} reminder should return an id.`);
          const deleteReminderResponse = await roleApi.delete(`/api/urgent-messages/${urgentId}`);
          assert.equal(deleteReminderResponse.status(), 200, `${user.role} should delete its own QA reminder.`);
        }
        result.urgentMessages.push({ role: user.role, adminStatus: urgentAdminResponse.status(), reminderStatus: urgentReminderResponse.status() });

        const indentorResponse = await roleApi.post("/api/indentors", {
          data: { divisionId, name: `${prefix}_${user.role}_indentor`, sfId: `${prefix}_${user.role}_sfid` },
        });
        if (indentorResponse.status() === 201) {
          const body = await indentorResponse.json();
          assert.ok(body.indentor?.id, `${user.role} indentor create should return an id.`);
          createdIndentors.push(body.indentor.id);
        } else {
          assert.equal(indentorResponse.status(), 403, `${user.role} unexpected indentor create status.`);
        }
        result.indentors.push({ role: user.role, createStatus: indentorResponse.status() });

        const firmResponse = await roleApi.post("/api/firms", {
          data: { firmName: `${prefix} ${user.role} firm`, firmType: "MSE", firmUniqueNo: `${prefix}_${user.role}_firm` },
        });
        if (firmResponse.status() === 201) {
          const body = await firmResponse.json();
          assert.ok(body.firm?.id, `${user.role} firm create should return an id.`);
          createdFirms.push(body.firm.id);
        } else {
          assert.equal(firmResponse.status(), 403, `${user.role} unexpected firm create status.`);
        }
        result.firms.push({ role: user.role, createStatus: firmResponse.status() });
      } finally {
        await roleApi.dispose();
      }
    }
    await json(
      await adminApi.put("/api/settings/deletion-password", {
        data: { deletionPassword: "QaDelete#2026", deletionPasswordConfirmation: "QaDelete#2026" },
      }),
      "configure QA deletion password for capability cleanup",
    );
    for (const id of createdIndentors) {
      await adminApi.delete(`/api/indentors/${id}`);
      await adminApi.delete(`/api/indentors/archive/${id}`, { data: { deletionPassword: "QaDelete#2026" } });
    }
    for (const id of createdFirms) {
      await adminApi.delete(`/api/firms/${id}`);
      await adminApi.delete(`/api/firms/archive/${id}`, { data: { deletionPassword: "QaDelete#2026" } });
    }
    return result;
  } finally {
    await adminApi.dispose();
  }
}

async function checkAdditionalRolePowers(api, users, divisionId) {
  const subAdmin = users.find((user) => user.role === "sub_admin");
  const auditAdmin = users.find((user) => user.role === "admin");
  assert.ok(subAdmin && auditAdmin, "Role-power audit users are missing.");
  const subApi = await playwrightRequest.newContext({ baseURL: apiBaseUrl });
  const adminApi = await playwrightRequest.newContext({ baseURL: apiBaseUrl });
  const result = { subAdmin: {}, userManagementBoundaries: [], universalViewers: [] };
  const createdIndentorNames = `${prefix}_indentor`;
  const createdFirmUniqueNo = `${prefix}_firm`;
  try {
    await loginApi(subApi, subAdmin.username, password);
    await loginApi(adminApi, auditAdmin.username, password);

    const usersResponse = await subApi.get("/api/users");
    assert.equal(usersResponse.status(), 200, "Sub-admin should be able to view users in its division scope.");
    result.subAdmin.canViewUsers = true;
    const subAdminCreateResponse = await subApi.post("/api/users", { data: {} });
    assert.equal(subAdminCreateResponse.status(), 403, "Sub-admin must not create user accounts.");
    result.subAdmin.cannotCreateUsers = true;

    const indentor = await json(
      await subApi.post("/api/indentors", {
        data: { divisionId, name: createdIndentorNames, sfId: `${prefix}_sfid` },
      }),
      "sub-admin create indentor",
    );
    assert.ok(indentor.indentor?.id);
    const indentorId = indentor.indentor.id;
    await json(
      await subApi.patch(`/api/indentors/${indentorId}`, {
        data: { divisionId, name: `${createdIndentorNames}_edited`, sfId: `${prefix}_sfid` },
      }),
      "sub-admin edit indentor",
    );
    await json(await subApi.delete(`/api/indentors/${indentorId}`), "sub-admin archive indentor");
    await json(await subApi.post(`/api/indentors/archive/${indentorId}/restore`), "sub-admin restore indentor");
    await json(await subApi.delete(`/api/indentors/${indentorId}`), "sub-admin re-archive indentor");

    const firm = await json(
      await subApi.post("/api/firms", {
        data: { firmName: `${prefix} firm`, firmType: "MSE", firmUniqueNo: createdFirmUniqueNo },
      }),
      "sub-admin create firm",
    );
    assert.ok(firm.firm?.id);
    const firmId = firm.firm.id;
    await json(
      await subApi.patch(`/api/firms/${firmId}`, {
        data: { firmName: `${prefix} firm edited`, firmType: "MSE", firmUniqueNo: createdFirmUniqueNo },
      }),
      "sub-admin edit firm",
    );
    await json(await subApi.delete(`/api/firms/${firmId}`), "sub-admin archive firm");
    await json(await subApi.post(`/api/firms/archive/${firmId}/restore`), "sub-admin restore firm");
    await json(await subApi.delete(`/api/firms/${firmId}`), "sub-admin re-archive firm");

    await json(
      await adminApi.put("/api/settings/deletion-password", {
        data: { deletionPassword: "QaDelete#2026", deletionPasswordConfirmation: "QaDelete#2026" },
      }),
      "configure QA deletion password",
    );
    await json(
      await adminApi.delete(`/api/indentors/archive/${indentorId}`, {
        data: { deletionPassword: "QaDelete#2026" },
      }),
      "admin clean indentor",
    );
    await json(
      await adminApi.delete(`/api/firms/archive/${firmId}`, {
        data: { deletionPassword: "QaDelete#2026" },
      }),
      "admin clean firm",
    );
    result.subAdmin.canManageIndentors = true;
    result.subAdmin.canManageFirms = true;
    result.subAdmin.archiveRestoreRoundTrip = true;
  } finally {
    await subApi.dispose();
    await adminApi.dispose();
  }

  for (const user of users.filter((item) => item.role !== "admin" && item.role !== "sub_admin")) {
    const roleApi = await playwrightRequest.newContext({ baseURL: apiBaseUrl });
    try {
      await loginApi(roleApi, user.username, password);
      const listResponse = await roleApi.get("/api/users");
      assert.equal(listResponse.status(), 403, `${user.role} must not view user accounts.`);
      const createResponse = await roleApi.post("/api/users", { data: {} });
      assert.equal(createResponse.status(), 403, `${user.role} must not create user accounts.`);
      result.userManagementBoundaries.push({ role: user.role, listStatus: listResponse.status(), createStatus: createResponse.status() });
    } finally {
      await roleApi.dispose();
    }
  }

  for (const user of users.filter((item) => item.role === "universal_viewer")) {
    const universalApi = await playwrightRequest.newContext({ baseURL: apiBaseUrl });
    try {
      await loginApi(universalApi, user.username, password);
      const plan = await json(await universalApi.get("/api/reports/pre-so-cash-outgo-plan"), `${user.username} cash-out-go plan`);
      const expectedCanSave = user.cashOutgoEditScope !== "none";
      assert.equal(plan.plan?.canSave, expectedCanSave, `${user.cashOutgoEditScope} Universal Viewer save capability mismatch.`);
      const saveResponse = await universalApi.put("/api/reports/cash-out-go-plan", {
        data: {
          billOffsetDays: plan.plan?.settings?.billOffsetDays ?? 30,
          useCustomBillOffsetDays: false,
          handSubmissionOffsetDays: plan.plan?.settings?.handSubmissionOffsetDays ?? 30,
          useCustomHandSubmissionOffsetDays: false,
          dpOffsetDays: plan.plan?.settings?.dpOffsetDays ?? 30,
          useCustomDpOffsetDays: false,
          saveSettings: false,
          rows: [],
          advancePaymentDateUpdates: [],
          stageOffsets: [],
          filePlans: [],
        },
      });
      assert.equal(saveResponse.status(), expectedCanSave ? 200 : 403, `${user.cashOutgoEditScope} Universal Viewer plan write boundary mismatch.`);
      result.universalViewers.push({
        username: user.username,
        scope: user.cashOutgoEditScope,
        canSave: plan.plan?.canSave,
        saveStatus: saveResponse.status(),
      });
    } finally {
      await universalApi.dispose();
    }
  }
  return result;
}

function financialYearArchived(settings, label) {
  return (settings.financialYearStatuses ?? []).some(
    (status) => status?.label === label && status?.archived === true,
  );
}

async function checkFinancialYearArchivePermissions(api, users) {
  const admin = users.find((user) => user.role === "admin");
  assert.ok(admin, "Archive audit admin is missing.");

  const before = (await json(await api.get("/api/settings"), "load archive settings")).settings;
  const currentYear = before.financialYear;
  const targetYear = (before.financialYears ?? []).find((year) => year !== currentYear);
  assert.ok(targetYear, "QA database must contain a non-current financial year for archive testing.");
  const initialArchived = financialYearArchived(before, targetYear);
  const desiredArchived = !initialArchived;

  const currentYearResponse = await api.patch(
    `/api/settings/financial-years/${encodeURIComponent(currentYear)}/archive`,
    { data: { archived: true } },
  );
  assert.equal(currentYearResponse.status(), 400, "The current financial year must not be archivable.");

  const adminMutation = await api.patch(
    `/api/settings/financial-years/${encodeURIComponent(targetYear)}/archive`,
    { data: { archived: desiredArchived } },
  );
  assert.equal(adminMutation.status(), 200, "Admin should be able to archive or restore a non-current year.");
  const afterAdminMutation = (await json(await api.get("/api/settings"), "verify archive mutation")).settings;
  assert.equal(
    financialYearArchived(afterAdminMutation, targetYear),
    desiredArchived,
    "Admin archive/restore mutation should persist.",
  );

  const denied = [];
  try {
    for (const user of users.filter((item) => item.role !== "admin")) {
      const roleApi = await playwrightRequest.newContext({ baseURL: apiBaseUrl });
      try {
        await loginApi(roleApi, user.username, passwordFor(user.username));
        const response = await roleApi.patch(
          `/api/settings/financial-years/${encodeURIComponent(targetYear)}/archive`,
          { data: { archived: !desiredArchived } },
        );
        assert.equal(response.status(), 403, `${user.role} must not archive or restore financial years.`);
        denied.push({ role: user.role, status: response.status() });
      } finally {
        await roleApi.dispose();
      }
      const unchanged = (await json(await api.get("/api/settings"), "verify archive denial")).settings;
      assert.equal(
        financialYearArchived(unchanged, targetYear),
        desiredArchived,
        `${user.role} archive denial must not change the financial-year state.`,
      );
    }
  } finally {
    const restoreResponse = await api.patch(
      `/api/settings/financial-years/${encodeURIComponent(targetYear)}/archive`,
      { data: { archived: initialArchived } },
    );
    assert.equal(restoreResponse.status(), 200, "Archive audit must restore the original financial-year state.");
    const restored = (await json(await api.get("/api/settings"), "verify archive restoration")).settings;
    assert.equal(
      financialYearArchived(restored, targetYear),
      initialArchived,
      "Archive audit must leave the QA database in its original state.",
    );
  }

  return {
    targetYear,
    initialArchived,
    adminMutation: { archived: desiredArchived, status: adminMutation.status() },
    currentYearRejected: currentYearResponse.status(),
    denied,
    restoredOriginalState: true,
  };
}

async function checkUniversalViewerSettingsBoundary(browser, user) {
  const { context, page } = await loginBrowser(browser, user.username);
  try {
    const labels = await visibleSettingsLabels(page);
    const forbidden = [
      "Quick Entry Excel",
      "Workspace",
      "Year Setup",
      "MMG Summary",
      "Demand Processing Analysis Presets",
      "Divisions",
      "Indentors",
      "Firm Database",
      "Firm Rating",
      "File Types",
      "Modes",
      "GeM Bidding Modes",
      "Firm Types",
      "File Markers",
      "TCEC Committee",
      "Value thresholds",
      "BG receipt delay",
      "Anomaly Control",
      "Milestones",
      "Authorised users",
      "IP Access",
      "Archive",
      "Protected backup",
    ];
    for (const label of forbidden) {
      assert.ok(!labels.includes(label), `Universal Viewer must not see general Settings section ${label}.`);
    }
    return { visible: labels, deniedSections: forbidden };
  } finally {
    await context.close();
  }
}

async function checkMergeSplitUnavailable(browser, user) {
  const { context, page } = await loginBrowser(browser, user.username);
  try {
    await page.goto(`${frontendUrl}/settings?section=yearSetup`, { waitUntil: "networkidle" });
    await dismissUrgentDialog(page);
    await page.getByRole("heading", { name: /Add a division for/i }).waitFor({ state: "visible", timeout: 10_000 });
    assert.equal(
      await page.getByRole("heading", { name: /Merge divisions for/i }).count(),
      0,
      "Merge must remain unavailable while the feature is intentionally disabled.",
    );
    assert.equal(
      await page.getByRole("heading", { name: /Split \/ transfer division for/i }).count(),
      0,
      "Split must remain unavailable while the feature is intentionally disabled.",
    );
    return { setupVisible: true, mergeVisible: false, splitVisible: false };
  } finally {
    await context.close();
  }
}

async function main() {
  const api = await playwrightRequest.newContext({ baseURL: apiBaseUrl });
  const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL ?? "chrome" });
  const users = [];
  try {
    await loginApi(api, adminUsername, adminPassword);
    const divisionsBody = await json(await api.get("/api/divisions?includeInactive=true"), "list divisions");
    const filesBody = await json(await api.get("/api/files?year=all"), "list QA files");
    const messageDivisionIds = new Set(
      (divisionsBody.divisions ?? [])
        .filter((division) => division.messagesEnabled !== false)
        .map((division) => division.id),
    );
    const divisionId =
      filesBody.files?.find((file) => messageDivisionIds.has(file.divisionId))?.divisionId ??
      divisionsBody.divisions?.find((division) => !division.archivedAt)?.id;
    assert.ok(divisionId, "QA database must contain an active division.");

    const roleDefinitions = [
      ["admin", "none"],
      ["sub_admin", "none"],
      ["editor", "none"],
      ["division_user", "none"],
      ["viewer", "none"],
      ["universal_viewer_none", "none"],
      ["universal_viewer_personal", "personal"],
      ["universal_viewer_global", "global"],
    ];
    for (const [roleKey, cashOutgoEditScope] of roleDefinitions) {
      const role = roleKey.startsWith("universal_viewer") ? "universal_viewer" : roleKey;
      const username = `${prefix}_${roleKey}`;
      credentials.set(username, password);
      users.push(await createUser(api, {
        username,
        role,
        divisionIds: role === "admin" ? [] : [divisionId],
        cashOutgoEditScope,
      }));
    }

    const rolePowerResults = await checkAdditionalRolePowers(api, users, divisionId);
    const archivePermissions = await checkFinancialYearArchivePermissions(api, users);

    const roleResults = [];
    for (const user of users) {
      const { context, page } = await loginBrowser(browser, user.username);
      try {
        const labels = await visibleSettingsLabels(page);
        const expected = expectedSettings[user.role];
        assert.ok(expected, `No expected Settings map for ${user.role}.`);
        for (const label of expected) {
          assert.ok(labels.includes(label), `${user.role} should see Settings tab ${label}; visible labels: ${labels.join(" | ")}`);
        }
        if (user.role === "editor" || user.role === "sub_admin") {
          assert.ok(!labels.includes("Protected backup"), `${user.role} must not see Protected backup.`);
        }
        if (user.role === "universal_viewer") {
          assert.ok(!labels.includes("Protected backup"), "Universal Viewer must not see Protected backup.");
          assert.ok(!labels.includes("Authorised users"), "Universal Viewer must not see Authorised users.");
        }
        roleResults.push({ role: user.role, username: user.username, settingsLabels: labels });
      } finally {
        await context.close();
      }
    }

    const navigation = [];
    for (const user of users) navigation.push(await checkNavigationVisibility(browser, user));

    const coreCapabilityMatrix = await checkCoreCapabilityMatrix(api, users, divisionId);

    const persistence = [];
    for (const user of users.filter((item) => ["admin", "sub_admin", "editor", "division_user", "viewer", "universal_viewer"].includes(item.role))) {
      persistence.push({ role: user.role, username: user.username, ...(await checkSettingsDraftPersistence(browser, user)) });
    }

    const sectionRendering = [];
    for (const user of users) {
      sectionRendering.push({
        role: user.role,
        username: user.username,
        sections: await checkSettingsSectionRendering(browser, user),
      });
    }

    const forbidden = [];
    const roleUsers = users.filter((user) => user.role !== "admin");
    for (const user of roleUsers) {
      const roleApi = await playwrightRequest.newContext({ baseURL: apiBaseUrl });
      try {
        await loginApi(roleApi, user.username, password);
        const response = await roleApi.patch("/api/settings", { data: { financialYear: "2099-00" } });
        assert.equal(response.status(), 403, `${user.role} must not update shared admin settings.`);
        forbidden.push({ role: user.role, status: response.status() });
      } finally {
        await roleApi.dispose();
      }
    }

    const universalViewer = users.find((user) => user.role === "universal_viewer");
    assert.ok(universalViewer, "Universal Viewer audit user is missing.");
    const universalViewerSettingsBoundary = await checkUniversalViewerSettingsBoundary(browser, universalViewer);
    const adminUser = users.find((user) => user.role === "admin");
    assert.ok(adminUser, "Admin audit user is missing for the Year Setup check.");
    const mergeSplitAvailability = await checkMergeSplitUnavailable(browser, adminUser);

    process.stdout.write(`${JSON.stringify({
      database: qaDatabase,
      accountsCreated: users.map(({ username, role, cashOutgoEditScope }) => ({ username, role, cashOutgoEditScope })),
      settingsVisibility: roleResults,
      navigationVisibility: navigation,
      coreCapabilityMatrix,
      personalSettingsPersistence: persistence,
      settingsSectionRendering: sectionRendering,
      sharedAdminWriteProtection: forbidden,
      additionalRolePowers: rolePowerResults,
      financialYearArchivePermissions: archivePermissions,
      universalViewerSettingsBoundary,
      mergeSplitAvailability,
    }, null, 2)}\n`);
  } finally {
    for (const user of users) {
      await api.delete(`/api/users/${encodeURIComponent(user.id)}`).catch(() => undefined);
    }
    await browser.close();
    await api.dispose();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
