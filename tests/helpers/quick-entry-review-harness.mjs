import fs from "node:fs";
import ts from "typescript";
import vm from "node:vm";
import React from "react";
const source = fs.readFileSync(
  new URL("../../src/routes/quick-entry.tsx", import.meta.url),
  "utf8",
);
const ast = ts.createSourceFile(
  "quick-entry.tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
export async function quickEntryHarness(overrides = {}) {
  const env = { React, console: { error() {} }, exports: {}, ...overrides };
  for (const statement of ast.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const module = statement.moduleSpecifier.text;
    if (
      !module.startsWith("@/lib/") ||
      ["files-store", "unsaved-changes"].some((x) => module.endsWith(x))
    )
      continue;
    const imported = await import(
      new URL(`../../src/lib/${module.split("/").at(-1)}.ts`, import.meta.url)
    );
    for (const item of statement.importClause?.namedBindings?.elements ?? []) {
      if (!item.isTypeOnly)
        env[item.name.text] = imported[item.propertyName?.text ?? item.name.text];
    }
  }
  const constants = ["quickEntryStageSections", "supplyOrderQuickEntryMilestones"];
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
  const evaluate = (code) =>
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
  evaluate(code);
  return { env, evaluate };
}
export function editorHandlers(names) {
  const component = ast.statements.find(
    (item) => ts.isFunctionDeclaration(item) && item.name.text === "QuickEntryEditor",
  );
  return component.body.statements
    .filter(
      (item) =>
        ts.isVariableStatement(item) &&
        item.declarationList.declarations.some((d) => names.includes(d.name.getText(ast))),
    )
    .map((item) => item.getText(ast))
    .join("\n");
}
