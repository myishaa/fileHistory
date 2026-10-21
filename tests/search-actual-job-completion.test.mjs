import assert from "node:assert/strict";
import test from "node:test";
import { searchFiles } from "../backend/src/utils/file-search.ts";

process.env.DATABASE_URL ??= "postgres://localhost/recordkeeper_test";
const { supplyOrderActualJobCompletionDateRangeSql } = await import(
  "../backend/src/routes/files.ts"
);

test("Actual Job Completion date search matches parent S.O. and stage dates", () => {
  const files = [
    {
      id: "parent-date",
      supplyOrders: [{ actualJobCompletionDate: "2026-08-12" }],
    },
    {
      id: "stage-date",
      supplyOrders: [
        {
          stageDelivery: "Yes",
          actualJobCompletionDate: "",
          stageDeliveries: [{ actualJobCompletionDate: "2026-08-22" }],
        },
      ],
    },
    {
      id: "outside-range",
      supplyOrders: [
        {
          actualJobCompletionDate: "2026-09-02",
          stageDeliveries: [{ actualJobCompletionDate: "" }],
        },
      ],
    },
    { id: "no-date", supplyOrders: [{ jobCompletionDate: "2026-08-18" }] },
  ];

  const result = searchFiles(files, {
    actualJobCompletionFrom: "2026-08-01",
    actualJobCompletionTo: "2026-08-31",
  });

  assert.deepEqual(result.map((file) => file.id), ["parent-date", "stage-date"]);
});

test("Actual Job Completion SQL range checks parent and stage dates with shared bounds", () => {
  const values = [];
  const sql = supplyOrderActualJobCompletionDateRangeSql(
    "2026-08-01",
    "2026-08-31",
    values,
  );

  assert.deepEqual(values, ["2026-08-01", "2026-08-31"]);
  assert.match(sql, /so\.actual_job_completion_date >= \$1::date/);
  assert.match(sql, /so\.actual_job_completion_date <= \$2::date/);
  assert.match(sql, /jsonb_array_elements\(coalesce\(so\.stage_deliveries/);
  assert.ok(
    sql.includes(
      "nullif(btrim(actual_completion_stage.stage ->> 'actualJobCompletionDate'), '')::date >= $1::date",
    ),
  );
  assert.ok(
    sql.includes(
      "nullif(btrim(actual_completion_stage.stage ->> 'actualJobCompletionDate'), '')::date <= $2::date",
    ),
  );
});
