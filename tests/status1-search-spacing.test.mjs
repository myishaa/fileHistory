import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const searchSource = fs.readFileSync(new URL("../src/routes/search.tsx", import.meta.url), "utf8");

test("Status-1 cancelled-order drill-down does not auto-expand blank detail rows", () => {
  assert.match(
    searchSource,
    /const isCancelledOrderFocusSearch = search\.focusTarget === "socancelled:yes"/,
  );
  assert.match(
    searchSource,
    /const shouldAutoExpandSearchResults =\s*!isCancelledOrderFocusSearch &&\s*Boolean\(/,
  );
  assert.match(searchSource, /if \(!shouldAutoExpandSearchResults\) \{/);
  assert.match(
    searchSource,
    /setExpandedSearchFileIds\(new Set\(results\.filter\(hasDetailedSearchRows\)\.map\(\(file\) => file\.id\)\)\)/,
  );
});
