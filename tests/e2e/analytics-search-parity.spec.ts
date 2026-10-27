import { expect, test } from "@playwright/test";

import { pool } from "../../backend/src/db/pool.js";
import { deleteSession, saveUserSession } from "../../backend/src/utils/auth.js";

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const prefix = `QA-ANALYTICS-PARITY-${suffix}`;
const username = `qa_analytics_parity_${suffix.replace(/[^a-z0-9]/gi, "")}`;
const divisionName = "QA Analytics Parity";
const supplierName = `${prefix} Supplier`;
const supplierNumber = `${prefix}-SUPPLIER`;
const mainBidder = `${prefix} Main Bidder`;
const mainBidderNumber = `${prefix}-MAIN`;
const partnerBidder = `${prefix} Partner Bidder`;
const partnerBidderNumber = `${prefix}-PARTNER`;
const indentor = `${prefix} Indentor`;
const baseUrl = `http://localhost:${Number(process.env.PLAYWRIGHT_BACKEND_PORT ?? 3000)}`;

test("Analytics firm, Indentor–Firm, and co-bidding Search results honor the selected scope", async () => {
  await pool.query("insert into divisions (name) values ($1) on conflict (name) do nothing", [
    divisionName,
  ]);
  const user = await pool.query<{ id: string }>(
    `insert into app_users (name, username, role, password_hash, is_active)
     values ('Analytics Parity E2E', $1, 'admin', crypt($2, gen_salt('bf')), true)
     returning id`,
    [username, "unused-test-password"],
  );
  const userId = user.rows[0]?.id;
  if (!userId) throw new Error("Could not create the Analytics parity E2E user.");
  const token = await saveUserSession(userId);
  const cookie = `recordkeeper_session=${encodeURIComponent(token)}`;
  const fileIds: string[] = [];

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
    const createFile = async (index: number, closed = false, unassignedZeroValue = false) => {
      const uniqueCode = `${prefix}-${index}`;
      const created = await api("/api/files", "POST", {
        uniqueCode,
        fileNo: uniqueCode,
        year: "2026-27",
        division: divisionName,
        fileType: "Goods & Services",
        fileTypeGroup: "goodsServices",
        mode: "Open",
        gem: "No",
        demandDescription: prefix,
        receivedDate: "2026-05-01",
        indentor,
        completedMilestones: closed ? ["File Closed"] : [],
        fileClosureDate: closed ? "2026-09-01" : "",
        bidderFirms: [
          { firmName: mainBidder, firmUniqueNo: mainBidderNumber, city: "Delhi" },
          { firmName: partnerBidder, firmUniqueNo: partnerBidderNumber, city: "Pune" },
        ],
        supplyOrders: [
          {
            currentMilestone: "Payment",
            psbApplicable: "No",
            bgCoverageType: "None",
            soNo: `${uniqueCode}-SO`,
            soDate: "2026-06-01",
            soValueCapital: unassignedZeroValue ? "0" : "1000",
            soValueRevenue: "0",
            firm: unassignedZeroValue ? "" : supplierName,
            firmUniqueNo: unassignedZeroValue ? "" : supplierNumber,
            firmCity: "New Delhi",
            soCancelled: "No",
            stageDelivery: "No",
            stagePayment: "No",
            advancePayment: "No",
            noFurtherAction: "No",
          },
        ],
      });
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      const fileId = (created.body as { file: { id: string } }).file.id;
      fileIds.push(fileId);
      return { fileId, uniqueCode };
    };

    const first = await createFile(1);
    const second = await createFile(2);
    const closed = await createFile(3, true);
    const zeroValue = await createFile(4, false, true);
    const scope = "__all_active_files__";
    const search = async (params: URLSearchParams) =>
      api(`/api/files/search?${params}`, "GET");
    const ids = (result: { body: unknown }) =>
      ((result.body as { files: Array<{ id: string }> }).files ?? []).map((file) => file.id).sort();

    const summaryQuery = new URLSearchParams({
      division: "all",
      selectedYear: scope,
      fileYear: "all",
    });
    const summaryResponse = await api(`/api/dashboard/summary?${summaryQuery}`, "GET");
    expect(summaryResponse.ok, JSON.stringify(summaryResponse.body)).toBe(true);
    const summary = (summaryResponse.body as {
      summary: {
        analytics: {
          topFirmSupplyOrders: Array<{ name: string; value: number }>;
          firmAnalysis: Array<{ name: string; order: number }>;
        };
      };
    }).summary;
    expect(
      summary.analytics.topFirmSupplyOrders.find((row) => row.name === supplierName)?.value,
    ).toBe(2000);
    expect(summary.analytics.firmAnalysis.find((row) => row.name === supplierName)?.order).toBe(2);

    const topFirmQuery = new URLSearchParams({
      analyticsType: "firm",
      analyticsNames: JSON.stringify([supplierName]),
      selectedYear: scope,
      description: prefix,
      pageSize: "100",
    });
    const topFirm = await search(topFirmQuery);
    expect(topFirm.ok, JSON.stringify(topFirm.body)).toBe(true);
    expect(ids(topFirm)).toEqual([first.fileId, second.fileId].sort());

    const unassignedQuery = new URLSearchParams({
      analyticsType: "firm",
      analyticsNames: JSON.stringify(["Unassigned firm"]),
      selectedYear: scope,
      description: prefix,
      pageSize: "100",
    });
    const unassigned = await search(unassignedQuery);
    expect(unassigned.ok, JSON.stringify(unassigned.body)).toBe(true);
    expect(ids(unassigned)).not.toContain(zeroValue.fileId);

    const firmAnalysisQuery = new URLSearchParams({
      dashboardFilter: `firmAnalysis:expr:order:${encodeURIComponent(supplierName)}`,
      selectedYear: scope,
      description: prefix,
      pageSize: "100",
    });
    const firmAnalysis = await search(firmAnalysisQuery);
    expect(firmAnalysis.ok, JSON.stringify(firmAnalysis.body)).toBe(true);
    expect(ids(firmAnalysis)).toEqual([first.fileId, second.fileId].sort());

    const indentorFirmQuery = new URLSearchParams({
      dashboardFilter: `analyticsIndentorFirm:${encodeURIComponent(indentor)}:no%3A${encodeURIComponent(supplierNumber)}`,
      selectedYear: scope,
      description: prefix,
      pageSize: "100",
    });
    const indentorFirm = await search(indentorFirmQuery);
    expect(indentorFirm.ok, JSON.stringify(indentorFirm.body)).toBe(true);
    expect(ids(indentorFirm)).toEqual([first.fileId, second.fileId].sort());
    expect(ids(indentorFirm)).not.toContain(closed.fileId);

    const coBiddingSourceQuery = new URLSearchParams({
      selectedYear: scope,
      division: "all",
      mainFirm: mainBidder,
    });
    const coBiddingSource = await api(`/api/dashboard/co-bidding-firms?${coBiddingSourceQuery}`, "GET");
    expect(coBiddingSource.ok, JSON.stringify(coBiddingSource.body)).toBe(true);
    const partnerKey = `no:${partnerBidderNumber.toLowerCase()}`;
    const sourcePair = (coBiddingSource.body as {
      firms: Array<{ key: string; count: number }>;
    }).firms.find((firm) => firm.key === partnerKey);
    // Co-bidding is based on recorded bidder participation.  An active file
    // still counts even when its S.O. has zero value or no assigned supplier.
    expect(sourcePair?.count).toBe(3);

    const coBiddingQuery = new URLSearchParams({
      dashboardFilter: `analyticsCoBidding:${encodeURIComponent(mainBidder)}:no%3A${encodeURIComponent(partnerBidderNumber)}`,
      selectedYear: scope,
      description: prefix,
      pageSize: "100",
    });
    const coBidding = await search(coBiddingQuery);
    expect(coBidding.ok, JSON.stringify(coBidding.body)).toBe(true);
    expect(ids(coBidding)).toEqual([first.fileId, second.fileId, zeroValue.fileId].sort());
  } finally {
    if (fileIds.length) await pool.query("delete from files where id = any($1::uuid[])", [fileIds]);
    await deleteSession(token);
    await pool.query("delete from app_users where id = $1", [userId]);
    await pool.query(
      `delete from divisions where name = $1
       and not exists (select 1 from files where division_id = divisions.id)`,
      [divisionName],
    );
  }
});
