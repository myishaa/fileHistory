import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";

const settingsSource = fs.readFileSync(
  new URL("../src/routes/settings.tsx", import.meta.url),
  "utf8",
);
const backendSource = fs.readFileSync(
  new URL("../backend/src/routes/settings.ts", import.meta.url),
  "utf8",
);

function recoveryPasswordInputs() {
  const sourceFile = ts.createSourceFile(
    "settings.tsx",
    settingsSource,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const inputs = [];
  function visit(node) {
    if (
      ts.isJsxSelfClosingElement(node) &&
      node.tagName.getText(sourceFile) === "PasswordInput" &&
      node.attributes.getText(sourceFile).includes("recoveryPinVerified")
    ) {
      inputs.push(node.getText(sourceFile));
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return inputs;
}

test("both forgot-password fields are gated by verified Recovery PIN state", () => {
  const inputs = recoveryPasswordInputs();
  const gatedInputs = inputs.filter((input) => input.includes("disabled={!recoveryPinVerified}"));

  assert.equal(gatedInputs.length, 2);
  assert.ok(gatedInputs.some((input) => input.includes("value={recoveryPassword}")));
  assert.ok(gatedInputs.some((input) => input.includes("value={recoveryConfirmation}")));
  assert.match(settingsSource, /restore-authorization\/recovery-pin\/verify/);
  assert.match(settingsSource, /!recoveryPinVerified\s*\|\|\s*!recoveryPasswordsMatch/);
});

test("Recovery PIN verification is enforced by the server before password recovery", () => {
  assert.match(
    backendSource,
    /settingsRouter\.post\(\s*"\/protected-backup\/restore-authorization\/recovery-pin\/verify"/,
  );
  assert.match(
    backendSource,
    /const recoveryPin = await verifyRestoreAuthorizationRecoveryPin\(body\.recoveryPin\)/,
  );
});
