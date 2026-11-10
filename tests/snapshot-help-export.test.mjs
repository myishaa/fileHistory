import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import ts from "typescript";
import vm from "node:vm";
import { buildDashboardSummary } from "../backend/src/utils/dashboard-summary.ts";
import { dashboardHarness, descendants } from "./helpers/dashboard-review-harness.mjs";

const { env, payload } = await dashboardHarness();
for (const name of ["TooltipProvider", "Tooltip", "TooltipTrigger", "TooltipContent"]) {
  env[name] = () => null;
}
const order = {
  id: "so1",
  soNo: "SO1",
  soDate: "2026-04-04",
  financialSanctionDate: "2026-04-03",
  firm: "Firm",
  firmType: "OTHER",
  firmTypeOther: "Custom / Firm",
  soValueRevenue: "100000",
  stageDelivery: "No",
  advancePayment: "No",
};
const file = {
  id: "f1",
  gem: "No",
  noOfSo: "2",
  fileType: "Custom / Service",
  fileTypeGroup: "goodsServices",
  valueRevenue: "100000",
  supplyOrders: [order, { ...order, id: "so2", soCancelled: "Yes" }],
};
const settings = {
  selectedYear: "__all_files__",
  financialYear: "2026-27",
  valueThresholdLevels: [],
  milestones: [],
  modes: [],
  fileTypes: [],
  firmTypes: [],
};
const backend = buildDashboardSummary({ files: [file], divisions: [], settings });
const source = fs.readFileSync(new URL("../src/routes/index.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile(
  "index.tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const component = ast.statements.find(
  (node) =>
    ts.isFunctionDeclaration(node) &&
    node.body?.statements.some(
      (statement) =>
        ts.isVariableStatement(statement) &&
        statement.declarationList.declarations.some(
          (d) => d.name.getText(ast) === "topSummaryStats",
        ),
    ),
);
const declarations = (names) =>
  component.body.statements
    .filter(
      (node) =>
        ts.isVariableStatement(node) &&
        node.declarationList.declarations.some((d) => names.includes(d.name.getText(ast))),
    )
    .map((node) => node.getText(ast))
    .join("\n");
function evaluate(code, values) {
  const context = { ...env, ...values };
  vm.createContext(context);
  vm.runInContext(
    ts.transpileModule(code, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
    }).outputText,
    context,
  );
  return context.result;
}

function categories(summary, fallback) {
  return evaluate(
    declarations(["topSummaryStats", "fileTypeStats", "firmTypeStats"]) +
      "\nglobalThis.result = [...topSummaryStats, fileTypeStats, firmTypeStats];",
    {
      dashboardSummary: summary,
      needsLocalDashboardFallback: fallback,
      dashboardProcessFiles: [file],
      settings,
    },
  );
}

test("backend counts retain frontend category explanations without changing values or filters", () => {
  const actual = categories(backend, false);
  const fallback = categories(undefined, true);
  actual.forEach((stat, index) => {
    assert.equal(stat.label, fallback[index].label);
    stat.value.forEach((item, i) => {
      if (item.searchFilter.startsWith("attribute:psb:")) return;
      assert.deepEqual([...item.help], [...fallback[index].value[i].help]);
      assert.ok(item.help.length);
    });
  });
  const input = [...backend.topSummaryStats, backend.fileTypeStats, backend.firmTypeStats];
  const numeric = (stat) =>
    stat.value.map(({ label, value, searchFilter }) => ({ label, value, searchFilter }));
  for (let i = 0; i < input.length; i++) {
    assert.equal(JSON.stringify(numeric(actual[i])), JSON.stringify(numeric(input[i])));
    assert.ok(input[i].value.every((item) => item.help === undefined));
  }
  const firm = actual
    .find((stat) => stat.label === "Firm Type")
    .value.find((item) => item.value === 2);
  assert.ok(firm.help.some((line) => line.includes("F.S.")));
  assert.ok(firm.help.some((line) => line.includes("Cancelled and shortclosed")));
  const custom = actual
    .find((stat) => stat.label === "File Type")
    .value.find((item) => item.label === file.fileType);
  assert.ok(custom.help[0].includes(file.fileType));
});

test("backend-rendered attribute, File Type and Firm Type entries show their info icons", () => {
  const stats = categories(backend, false);
  const iconCount = (stat) =>
    descendants(env.SummaryMetric({ ...stat, onSubMetricClick() {} })).filter(
      (node) => node.type === env.InlineInfoIcon,
    ).length;
  assert.equal(
    stats.slice(0, 12).reduce((n, stat) => n + iconCount(stat), 0),
    22,
  );
  for (const stat of stats.slice(12)) assert.equal(iconCount(stat), stat.value.length);
});

test("PSB and Non PSB tooltip entries remain unchanged, whether supplied or absent", () => {
  const psb = backend.topSummaryStats.find((stat) => stat.label === "PSB");
  const unchanged = env.withSnapshotCategoryHelp(psb);
  psb.value.forEach((item, i) => assert.equal(unchanged.value[i], item));
  const existing = env.getAttributeSummaryStats([file]).find((stat) => stat.label === "PSB");
  const kept = env.withSnapshotCategoryHelp(existing);
  existing.value.forEach((item, i) => {
    assert.equal(kept.value[i], item);
    assert.equal(kept.value[i].help, item.help);
  });
});

test("PDF and Excel export authoritative Files and S.O. totals and both checkbox states", async () => {
  const stats = categories(backend, false);
  const rows = env.getSnapshotExportRows(stats, backend);
  assert.equal(rows[0].metric, "Files");
  assert.equal(rows[0].value, backend.dashboardFileCount);
  assert.equal(rows[1].metric, "S.O.");
  assert.equal(rows[1].value, backend.dashboardSupplyOrderCount);
  assert.equal(backend.dashboardSupplyOrderCount, 1);
  assert.equal(
    rows.find((row) => row.section === "Firm Type" && row.metric.startsWith("Custom / Firm")).value,
    2,
  );
  const base = env.getDashboardExportDescription({
    globalYear: settings.selectedYear,
    fileYear: "all",
    division: "all",
    selectedFileCategories: [],
    visibleFileCategoryOptions: [],
  });
  const descriptions = new Set();
  for (const archived of [true, false])
    for (const cancelled of [true, false]) {
      const description = env.getSnapshotExportDescription(base, archived, cancelled);
      descriptions.add(description);
      assert.ok(
        description.includes(
          `Active files from archived years: ${archived ? "Checked" : "Unchecked"}`,
        ),
      );
      assert.ok(
        description.includes(
          `Files with all S.O.s cancelled: ${cancelled ? "Checked" : "Unchecked"}`,
        ),
      );
      for (const format of ["pdf", "excel"]) {
        await env.downloadSnapshotRows(rows, "Snapshot", format, description);
        const doc = payload();
        assert.equal(doc.format, format);
        assert.equal(doc.description, description);
        const totals = doc.tables.find((table) => table.title === "Snapshot");
        assert.equal(
          JSON.stringify(totals.rows),
          JSON.stringify([
            ["Files", backend.dashboardFileCount],
            ["S.O.", backend.dashboardSupplyOrderCount],
          ]),
        );
      }
    }
  assert.equal(descriptions.size, 4);
});

test("zero matching files exports explicit zero totals without inventing category values", () => {
  const rows = env.getSnapshotExportRows([], {
    dashboardFileCount: 0,
    dashboardSupplyOrderCount: 0,
  });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].value, 0);
  assert.equal(rows[1].value, 0);
  assert.equal(env.getSnapshotExportRows([]).length, 0);
});
