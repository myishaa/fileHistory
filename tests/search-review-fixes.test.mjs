import assert from "node:assert/strict";
import test from "node:test";
import { searchFiles } from "../backend/src/utils/file-search.ts";
import { fileSupplyOrders, filePaymentOrders } from "../src/lib/effective-deliveries.ts";
process.env.DATABASE_URL ??= "postgres://localhost/recordkeeper_test";
const {
  buildSearchSql,
  buildFileSearchExportTable,
  normalizeSearchExportMoney,
  appendSearchGlobalYearScope,
  quickStatusScopeSql,
} = await import("../backend/src/routes/files.ts");
const order = {
  id: "so1",
  soNo: "SO1",
  soDate: "2026-04-04",
  financialSanctionDate: "2026-04-03",
  soValueRevenue: "1000000.50",
  firm: "Firm A",
  firmType: "MSE",
  stageDelivery: "No",
  advancePayment: "No",
};
const file = {
  id: "f1",
  gem: "No",
  currency: "INR",
  noOfSo: "1",
  valueRevenue: "1000000.50",
  supplyOrders: [order],
};
const sql = (params) => buildSearchSql([], [], params, {});

test("decimal amounts use field identity, including abbreviated S.O. labels, in all export layouts", () => {
  const columns = [
    { key: "valueRevenue", label: "Demand" },
    { key: "soValueRevenue", label: "S.O. (Revenue)" },
    { key: "noOfSo", label: "No. of S.O." },
  ];
  for (const layout of ["rowwise", "sowise", "columnwise"]) {
    const table = normalizeSearchExportMoney(
      buildFileSearchExportTable([file], columns, layout),
      [file],
      columns,
      layout,
    );
    assert.equal(table.rows[0][1], "10");
    const amount = table.headers.findIndex((header) => header.includes("S.O. (Revenue)"));
    assert.equal(table.rows[0][amount], "10");
    assert.equal(table.rows[0][table.headers.indexOf("No. of S.O.")], "1");
  }
});
test("export count excludes reserved and partial orders without hiding their saved data", () => {
  const files = [
    { ...file, noOfSo: "3", supplyOrders: [order, { financialSanctionDate: "2026-04-05" }, {}] },
  ];
  const columns = [
    { key: "noOfSo", label: "Orders" },
    { key: "financialSanctionDate", label: "F.S." },
  ];
  const table = buildFileSearchExportTable(files, columns, "sowise");
  assert.equal(table.rows[0][1], "1");
  assert.ok(table.rows.some((row) => row.includes("2026-04-05")));
});
test("common staged payments export parent payment while stage payments aggregate stage actuals", () => {
  const columns = [
    { key: "paymentDate", label: "Payment date" },
    { key: "actualPaymentRevenue", label: "Actual" },
  ];
  const common = {
    ...file,
    supplyOrders: [
      {
        ...order,
        stageDelivery: "Yes",
        stagePayment: "No",
        paymentDate: "2026-10-20",
        actualPaymentRevenue: "500000",
        stageDeliveries: [
          { paymentDate: "2026-09-01", actualPaymentRevenue: "200000" },
          { paymentDate: "2026-10-01", actualPaymentRevenue: "200000" },
        ],
      },
    ],
  };
  const table = normalizeSearchExportMoney(
    buildFileSearchExportTable([common], columns, "sowise"),
    [common],
    columns,
    "sowise",
  );
  assert.deepEqual(table.rows[0].slice(-2), ["2026-10-20", "5"]);
  const staged = { ...common, supplyOrders: [{ ...common.supplyOrders[0], stagePayment: "Yes" }] };
  const table2 = normalizeSearchExportMoney(
    buildFileSearchExportTable([staged], columns, "sowise"),
    [staged],
    columns,
    "sowise",
  );
  assert.deepEqual(table2.rows[0].slice(-2), ["2026-10-01", "4"]);
});
test("stage and advance returned-bill histories use the same backend export calculation", () => {
  const f = {
    ...file,
    supplyOrders: [
      {
        ...order,
        stageDelivery: "Yes",
        stageDeliveries: [{ billReturnCycles: [{ returnedDate: "2026-08-01", reason: "Stage" }] }],
        advancePaymentDetail: {
          billReturnCycles: [{ returnedDate: "2026-09-01", reason: "Advance" }],
        },
      },
    ],
  };
  const table = buildFileSearchExportTable(
    [f],
    [{ key: "billReturnCycles", label: "Returns" }],
    "rowwise",
  );
  assert.ok(table.rows.some((row) => row.includes("Stage")));
  assert.ok(table.rows.some((row) => row.includes("Advance")));
});
test("D.P. and Material Receipt ranges inspect child stages with both bounds on each date", () => {
  for (const [params, key] of [
    [{ dpFrom: "2026-10-01", dpTo: "2026-10-31" }, "dpDate"],
    [{ materialReceiptFrom: "2026-10-01", materialReceiptTo: "2026-10-31" }, "materialReceiptDate"],
  ]) {
    const query = sql(params);
    assert.ok(query.whereSql.includes(`saved_stage.stage ->> '${key}'`));
    assert.match(query.whereSql, />= \$1::date/);
    assert.match(query.whereSql, /<= \$2::date/);
    const matching = {
      ...file,
      supplyOrders: [
        { ...order, stageDelivery: "Yes", stageDeliveries: [{ [key]: "2026-10-15" }] },
      ],
    };
    assert.equal(searchFiles([matching], params).length, 1);
  }
});
test("saved date display can include partial rows without making them countable", () => {
  const f = {
    ...file,
    supplyOrders: [
      {
        financialSanctionDate: "2026-04-03",
        stageDelivery: "Yes",
        stagePayment: "Yes",
        stageDeliveries: [{ materialReceiptDate: "2026-09-01", paymentDate: "2026-10-01" }],
      },
    ],
  };
  assert.equal(fileSupplyOrders(f).length, 0);
  assert.equal(fileSupplyOrders(f, true)[0].materialReceiptDate, "2026-09-01");
  assert.equal(filePaymentOrders(f).length, 0);
  assert.equal(filePaymentOrders(f, true)[0].paymentDate, "2026-10-01");
});
test("S.O. Include requires eligibility; child D.P. extension and LD are searchable", () => {
  const query = sql({
    soPresenceFilter: "include",
    dpExtensionFilter: true,
    ldFilter: true,
  }).whereSql;
  assert.ok(query.includes("financial_sanction_date"));
  assert.ok(query.includes("flag_stage.stage ->> 'dpExtension'"));
  assert.ok(query.includes("ld_stage.stage ->> 'ld'"));
  assert.equal(
    searchFiles([{ ...file, supplyOrders: [{}] }], { soPresenceFilter: "include" }).length,
    0,
  );
});
test("manual S.O. amounts and bands use INR per order, not a sum of separate orders", () => {
  const f = {
    ...file,
    currency: "USD",
    exchangeRate: "80",
    supplyOrders: [{ ...order, soValueRevenue: "10000" }],
  };
  assert.equal(searchFiles([f], { soValueFrom: "500000", soValueTo: "1000000" }).length, 1);
  const manual = sql({ soValueFrom: "500000", soValueTo: "1000000" }).whereSql;
  assert.ok(manual.includes("so.so_value_revenue * f.exchange_rate"));
  assert.ok(manual.includes("coalesce(case"));
  const split = {
    ...file,
    supplyOrders: [
      { ...order, soValueRevenue: "400000" },
      { ...order, id: "so2", soValueRevenue: "400000" },
    ],
    noOfSo: "2",
  };
  assert.equal(searchFiles([split], { soValueFrom: "700000", soValueTo: "900000" }).length, 0);
});
test("Post-TCEC committee and dates must belong to the same round", () => {
  const f = {
    ...file,
    postTcecCommitteeNumber: "A",
    postTcecDate: "2026-10-01",
    refloatPostTcecCommitteeNo: "B",
    refloatPostTcecDate: "2026-11-01",
  };
  const params = {
    postTcecCommittee: "A",
    postTcecDateFrom: "2026-11-01",
    postTcecDateTo: "2026-11-30",
  };
  assert.equal(searchFiles([f], params).length, 0);
  assert.equal(searchFiles([{ ...f, refloatPostTcecCommitteeNo: "A" }], params).length, 1);
  assert.equal(
    searchFiles([f], { postTcecCommittee: "A", refloatPostTcecDateFrom: "2026-11-01" }).length,
    0,
  );
  const query = sql(params);
  assert.ok(query.whereSql.includes("f.post_tcec_committee_number"));
  assert.ok(query.whereSql.includes("f.refloat_post_tcec_committee_no"));
  assert.equal(query.values.filter((value) => value === "a").length, 1);
});
test("inverted date and value ranges are rejected by SQL and matcher callers", () => {
  for (const params of [
    { dpFrom: "2026-11-02", dpTo: "2026-11-01", dateFilterModes: ["dpPeriod:exclude"] },
    { valueFrom: "200", valueTo: "100" },
    { soValueFrom: "2,000", soValueTo: "100" },
    { refloatBiddingDateFrom: "2026-11-02", refloatBiddingDateTo: "2026-11-01" },
  ]) {
    assert.throws(() => sql(params), /From must not exceed To/);
    assert.throws(() => searchFiles([file], params), /From must not exceed To/);
  }
});
test("manual workflow history overrides Active; ordinary firm filters retain Active", () => {
  for (const dashboardFilter of ["miscFileClosed", "miscShortclosedSo"]) {
    const conditions = [];
    appendSearchGlobalYearScope(conditions, [], "__all_active_files__", "2026-27", {
      dashboardFilter,
    });
    assert.equal(conditions.length, 1);
  }
  for (const params of [
    { firm: "Supplier" },
    { firmCity: "Delhi" },
    { firmContactNo: "123" },
    { selectedFirmTypes: ["MSE"] },
  ]) {
    const conditions = [];
    appendSearchGlobalYearScope(conditions, [], "__all_active_files__", "2026-27", params);
    assert.equal(conditions.length, 2);
    assert.match(conditions[1], /fileclosed/);
  }
});
test("Quick Viewer lookup restricts division and file category even with preexisting SQL arguments", () => {
  const values = ["identifier"];
  const query = quickStatusScopeSql(
    { role: "editor", divisionIds: ["division1"], allowedFileCategories: ["goodsServices"] },
    values,
  );
  assert.match(query, /f.division_id = any\(\$2::uuid\[\]\)/);
  assert.deepEqual(values, ["identifier", ["division1"]]);
  assert.ok(query.includes("file_type"));
});

test("the visible D.P. extension workflow filter examines the second S.O. and its stages", () => {
  const f = {
    ...file,
    noOfSo: "2",
    dpExtension: "No",
    supplyOrders: [
      { ...order, dpExtension: "No" },
      { ...order, id: "so2", stageDelivery: "Yes", stageDeliveries: [{ dpExtension: "Yes" }] },
    ],
  };
  assert.equal(searchFiles([f], { dashboardFilter: "dpExtension" }).length, 1);
  const query = sql({ dashboardFilter: "dpExtension" }).whereSql;
  assert.ok(query.includes("so.dp_extension"));
  assert.ok(query.includes("flag_stage.stage ->> 'dpExtension'"));
});

test("blank currency retains the default INR interpretation in Lakhs exports", () => {
  const f = { ...file, currency: "" };
  const columns = [{ key: "soValueRevenue", label: "S.O. (Revenue)" }];
  const table = normalizeSearchExportMoney(
    buildFileSearchExportTable([f], columns, "sowise"),
    [f],
    columns,
    "sowise",
  );
  assert.equal(table.rows[0].at(-1), "10");
});
