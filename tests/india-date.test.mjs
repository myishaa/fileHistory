import assert from "node:assert/strict";
import test from "node:test";
import { formatIndiaDate, formatIndiaMonth } from "../src/lib/india-date.ts";
import { formatIndiaDate as formatBackendIndiaDate } from "../backend/src/utils/india-date.ts";

test("India date formatting follows IST across the UTC date boundary", () => {
  const afterIndiaMidnight = new Date("2026-10-22T20:00:00.000Z");

  assert.equal(formatIndiaDate(afterIndiaMidnight), "2026-10-23");
  assert.equal(formatBackendIndiaDate(afterIndiaMidnight), "2026-10-23");
});

test("India month formatting follows IST across the UTC month boundary", () => {
  const afterIndiaMonthStart = new Date("2026-09-30T20:00:00.000Z");

  assert.equal(formatIndiaDate(afterIndiaMonthStart), "2026-10-01");
  assert.equal(formatIndiaMonth(afterIndiaMonthStart), "2026-10");
});
