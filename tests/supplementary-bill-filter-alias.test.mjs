import assert from "node:assert/strict";
import test from "node:test";
import { dashboardFilterSql } from "../backend/src/routes/files.ts";

test("legacy and canonical supplementary paid filters produce the same SQL", () => {
  const legacyValues = [];
  const canonicalValues = [];

  const legacySql = dashboardFilterSql("supplementaryBill:normalPaid", legacyValues);
  const canonicalSql = dashboardFilterSql("supplementaryBill:paid", canonicalValues);

  assert.equal(legacySql, canonicalSql);
  assert.deepEqual(legacyValues, canonicalValues);
});
