import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import ts from "typescript";
import vm from "node:vm";
const source = fs.readFileSync(new URL("../src/routes/search.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile(
  "search.tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const page = ast.statements.find(
  (item) => ts.isFunctionDeclaration(item) && item.name.text === "SearchPage",
);
function block(names) {
  return page.body.statements
    .filter(
      (item) =>
        ts.isVariableStatement(item) &&
        item.declarationList.declarations.some((d) => names.includes(d.name.getText(ast))),
    )
    .map((item) => item.getText(ast))
    .join("\n");
}
function evaluate(code, env) {
  vm.createContext(env);
  vm.runInContext(
    ts.transpileModule(code, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText,
    env,
  );
  return env;
}
function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { resolve, promise };
}
test("Reset clears every registered date range, including all eight refloat ranges", () => {
  const env = {
    search: {},
    defaultFirmSearchScopes: [],
    defaultSearchExclusions: false,
    defaultDemandCancelledExclusion: false,
  };
  const cleared = [];
  for (const name of source.match(/\bset[A-Z]\w+/g) ?? []) env[name] = () => cleared.push(name);
  evaluate(
    block(["dateRangeResetters", "clearAll"]) +
      "\nglobalThis.reset=clearAll;globalThis.rangeKeys=Object.keys(dateRangeResetters);",
    env,
  );
  env.reset();
  for (const key of [
    "RefloatGemUndertakingDate",
    "RefloatRfpVettingInitiationDate",
    "RefloatRfpVettingApprovalDate",
    "RefloatRecommendationDate",
    "RefloatBiddingDate",
    "RefloatBidOpeningDate",
    "RefloatPostTcecDate",
    "RefloatPostTcecMinutes",
  ]) {
    assert.ok(cleared.includes(`set${key}From`), key);
    assert.ok(cleared.includes(`set${key}To`), key);
  }
  assert.equal(env.rangeKeys.length, 34);
});
test("deactivating either date mode clears its From/To rather than leaving a hidden range", () => {
  for (const mode of ["only", "exclude"]) {
    const cleared = [];
    const env = {
      dateFilterModes: { dpPeriod: mode },
      setDateFilterModes: (fn) => {
        env.dateFilterModes = fn(env.dateFilterModes);
      },
    };
    for (const name of source.match(/\bset[A-Z]\w+/g) ?? [])
      if (!env[name]) env[name] = () => cleared.push(name);
    evaluate(
      block(["dateRangeResetters", "setDateFilterMode"]) + "\nglobalThis.toggle=setDateFilterMode;",
      env,
    );
    env.toggle("dpPeriod", mode);
    assert.equal(env.dateFilterModes.dpPeriod, undefined);
    assert.deepEqual(cleared, ["setDpFrom", "setDpTo"]);
  }
});
test("closing and reopening Snapshot rejects a slower previous response", async () => {
  const a = deferred(),
    b = deferred();
  let selected = { id: "A" };
  const env = {
    snapshotRequest: { current: 0 },
    snapshotSelectedFile: selected,
    includeArchivedYears: true,
    console: { error() {} },
    fetchQuickStatusContext: (id) => (id === "A" ? a.promise : b.promise),
  };
  for (const key of [
    "snapshotFile",
    "snapshotStatuses",
    "snapshotError",
    "snapshotLoading",
    "snapshotOpen",
  ])
    env[`set${key[0].toUpperCase() + key.slice(1)}`] = (value) => {
      env[key] = value;
    };
  evaluate(
    block(["changeSnapshotOpen", "openSnapshotReport"]) +
      "\nglobalThis.open=openSnapshotReport;globalThis.close=()=>changeSnapshotOpen(false);",
    env,
  );
  env.open();
  env.close();
  env.snapshotSelectedFile = { id: "B" };
  env.open();
  b.resolve({ file: { id: "B" }, statuses: [{ id: "B-status" }] });
  await new Promise((done) => setImmediate(done));
  a.resolve({ file: { id: "A" }, statuses: [{ id: "A-status" }] });
  await new Promise((done) => setImmediate(done));
  assert.equal(env.snapshotFile.id, "B");
  assert.equal(env.snapshotStatuses[0].id, "B-status");
  assert.equal(env.snapshotLoading, false);
});
test("multiple ordinary S.O.s are expandable without stages, supplementary bills or returns", () => {
  const node = ast.statements.find(
    (item) => ts.isFunctionDeclaration(item) && item.name.text === "hasDetailedSearchRows",
  );
  const env = {
    rawSupplyOrders: (file) => file.supplyOrders,
    isYes: (value) => value === "Yes",
    normalizeBillReturnCycles: (rows) => rows ?? [],
    normalizeSupplementaryBillsForTable: (rows) => rows ?? [],
  };
  evaluate(node.getText(ast), env);
  assert.equal(env.hasDetailedSearchRows({ supplyOrders: [{ soNo: "A" }, { soNo: "B" }] }), true);
});
