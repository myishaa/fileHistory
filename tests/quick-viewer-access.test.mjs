import assert from "node:assert/strict";
import test from "node:test";
process.env.DATABASE_URL ??= "postgres://localhost/recordkeeper_test";
const { filesRouter } = await import("../backend/src/routes/files.ts");
const { pool } = await import("../backend/src/db/pool.ts");
const editor = {
  id: "editor1",
  name: "Editor",
  role: "editor",
  divisionIds: ["division1"],
  allowedFileCategories: ["goodsServices"],
};
const denied = {
  id: "f1",
  division_id: "division1",
  file_id: "f1",
  file_type: "AMC",
  file_type_group: "contract",
};
function invoke(path, method, request) {
  const handler = filesRouter.stack.find(
    (layer) => layer.route?.path === path && layer.route.methods[method],
  ).route.stack[0].handle;
  return new Promise((resolve) =>
    handler(
      {
        authUser: editor,
        query: {},
        params: { id: "f1", statusId: "s1" },
        body: { text: "Status text" },
        ...request,
      },
      {
        status() {
          return this;
        },
        json(value) {
          resolve({ body: value });
        },
      },
      (error) => resolve({ error }),
    ),
  );
}
test("Quick Viewer detail and both status mutation routes deny an editor’s inaccessible current file type", async () => {
  const original = pool.query;
  const writes = [];
  pool.query = async (sql) => {
    if (/insert into file_status_updates|update file_status_updates\s+set/i.test(sql))
      writes.push(sql);
    if (
      sql.includes("select f.*") ||
      sql.includes("select f.division_id") ||
      sql.includes("select status.file_id")
    )
      return { rows: [denied] };
    if (sql.includes("select division_id from files"))
      return { rows: [{ division_id: "division1" }] };
    return { rows: [] };
  };
  try {
    for (const [path, method] of [
      ["/quick-status/:id", "get"],
      ["/quick-status/:id/status", "post"],
      ["/quick-status/status/:statusId", "patch"],
    ]) {
      const result = await invoke(path, method);
      assert.equal(result.error?.status, 403, `${method} ${path}: ${result.error?.message}`);
    }
    assert.equal(writes.length, 0);
  } finally {
    pool.query = original;
  }
});
test("status editing checks the file’s current division rather than its historical status division", async () => {
  const original = pool.query;
  let joinSeen = false;
  pool.query = async (sql) => {
    if (sql.includes("select status.file_id")) {
      joinSeen = /join files f on f.id = status.file_id/.test(sql) && /f.division_id/.test(sql);
      return { rows: [{ ...denied, file_type: "Goods & Services", division_id: "division2" }] };
    }
    if (/update file_status_updates\s+set/i.test(sql))
      assert.fail("must not mutate an inaccessible division");
    return { rows: [] };
  };
  try {
    const result = await invoke("/quick-status/status/:statusId", "patch");
    assert.equal(result.error?.status, 403);
    assert.ok(joinSeen);
  } finally {
    pool.query = original;
  }
});

test("an editor can still save File Status for an allowed category in their current division", async () => {
  const original = pool.query;
  let writes = 0;
  pool.query = async (sql) => {
    if (sql.includes("select f.division_id"))
      return { rows: [{ ...denied, file_type: "Goods & Services" }] };
    if (sql.includes("insert into file_status_updates")) writes++;
    return { rows: [] };
  };
  try {
    const result = await invoke("/quick-status/:id/status", "post");
    assert.equal(result.error, undefined);
    assert.ok(Array.isArray(result.body.statuses));
    assert.equal(writes, 1);
  } finally {
    pool.query = original;
  }
});
