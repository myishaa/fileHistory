import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const addSource = fs.readFileSync(new URL("../src/routes/add.tsx", import.meta.url), "utf8");

test("existing file navigation stays clean while the editor draft hydrates", () => {
  assert.match(addSource, /const editorHydrating = Boolean\(/);
  assert.match(addSource, /fileLoadStatus !== "loaded"/);
  assert.match(addSource, /editingFile\?\.id !== fileId/);
  assert.match(addSource, /hydratedEditorDraftKey !== editorDraftKey/);
  assert.match(addSource, /!readOnlyMode &&\s*!editorHydrating/);
});

test("legacy order-driven milestones do not make a file-level editor dirty", () => {
  assert.match(addSource, /const savedCompletedMilestonesForDirty = useMemo\(/);
  assert.match(
    addSource,
    /savedCompletedMilestonesForLocks\.filter\(\(milestone\) =>\s*fileLevelMilestoneOptions\.includes\(milestone\),/,
  );
  assert.match(
    addSource,
    /normalizeDirtyValue\("completedMilestones", savedCompletedMilestonesForDirty\)/,
  );
});
