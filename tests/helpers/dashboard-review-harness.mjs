import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import React from "react";

// Exercise the real private presentation/export functions without mounting the
// router, fetching data, or duplicating the calculations in a test fixture.
export async function dashboardHarness() {
  const path = new URL("../../src/routes/index.tsx", import.meta.url);
  const source = fs.readFileSync(path, "utf8");
  const ast = ts.createSourceFile(
    "index.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let payload;
  const env = {
    exports: {},
    React,
    Fragment: React.Fragment,
    useMemo: (calculate) => calculate(),
    useState: (initial) => [initial, () => {}],
    store: { getSettings: () => ({ chartColorOrder: [] }) },
    TableChartToggle: () => null,
    FileText: () => null,
    FileSpreadsheet: () => null,
    downloadBackendExport: async (value) => {
      payload = value;
    },
  };
  for (const statement of ast.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const module = statement.moduleSpecifier.text;
    if (
      ![
        "@/lib/effective-deliveries",
        "@/lib/file-type-groups",
        "@/lib/refloat-returned-bill",
        "@/lib/year-filter",
        "@/lib/money",
        "@/lib/chart-colors",
      ].includes(module)
    )
      continue;
    const imported = await import(
      new URL(`../../src/lib/${module.split("/").at(-1)}.ts`, import.meta.url)
    );
    for (const item of statement.importClause.namedBindings.elements) {
      if (!item.isTypeOnly)
        env[item.name.text] = imported[item.propertyName?.text ?? item.name.text];
    }
  }
  const constants = [
    "fileClosedMilestone",
    "supplyOrderMilestoneNames",
    "milestoneDefinitions",
    "dueActiveMilestoneKeys",
    "supplyOrderDateKeys",
    "supplementaryBillMetricHelp",
    "snapshotAttributeDefinitions",
    "financeExportHeaders",
  ];
  const code = ast.statements
    .filter(
      (item) =>
        ts.isFunctionDeclaration(item) ||
        (ts.isVariableStatement(item) &&
          item.declarationList.declarations.some((d) => constants.includes(d.name.getText(ast)))),
    )
    .map((item) => item.getText(ast))
    .join("\n");
  vm.createContext(env);
  vm.runInContext(
    ts.transpileModule(code, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.React,
      },
    }).outputText,
    env,
  );
  return { env, payload: () => payload };
}

export function descendants(element) {
  if (!element || typeof element !== "object") return [];
  if (Array.isArray(element)) return element.flatMap(descendants);
  return [element, ...descendants(element.props?.children)];
}
