import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("../src/routes/index.tsx", import.meta.url), "utf8");

test("status clicker grids size themselves from visible metrics", () => {
  assert.match(source, /function getStatusMetricGridClass\(count: number\)/);
  assert.match(source, /if \(count <= 1\) return "grid-cols-1"/);
  assert.match(source, /if \(count === 2 \|\| count === 4\) return "grid-cols-2"/);
  assert.match(source, /getStatusMetricGridClass\(visibleMetrics\.length\)/);
  assert.match(source, /getStatusMetricGridClass\(visibleJobMetrics\.length\)/);
  assert.match(source, /getStatusMetricGridClass\(visibleIrMetrics\.length\)/);
  assert.doesNotMatch(source, /const metricGridClass =/);
  assert.doesNotMatch(source, /grid-cols-2 gap-1\.5 sm:grid-cols-3/);
});
