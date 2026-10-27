import { readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { Client, Pool } = require("../backend/node_modules/pg");

const qaDatabaseUrl = process.env.QA_DATABASE_URL;
const productionDatabaseUrl = process.env.DATABASE_URL;
const action = process.env.QA_PERF_DB_ACTION ?? process.argv[2] ?? "init";
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const migrationDirectory = join(repositoryRoot, "database");

if (!qaDatabaseUrl) {
  throw new Error("QA_DATABASE_URL is required. Refusing to prepare a benchmark database without an explicit QA target.");
}

function databaseName(connectionString) {
  return new URL(connectionString).pathname.replace(/^\//, "");
}

function adminConnectionString(connectionString) {
  const url = new URL(connectionString);
  url.pathname = "/postgres";
  return url.toString();
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function assertSafeQaDatabase() {
  const target = databaseName(qaDatabaseUrl);
  if (!/^recordkeeper_qa_perf(?:[_-]|$)/i.test(target)) {
    throw new Error(`Refusing to operate on ${target}. QA database names must start with recordkeeper_qa_perf.`);
  }
  if (productionDatabaseUrl && databaseName(productionDatabaseUrl) === target) {
    throw new Error("QA_DATABASE_URL must point to a different database from DATABASE_URL.");
  }
  return target;
}

async function databaseExists(client, target) {
  const result = await client.query("select 1 from pg_database where datname = $1", [target]);
  return result.rowCount > 0;
}

async function createDatabase(target) {
  const client = new Client({ connectionString: adminConnectionString(qaDatabaseUrl) });
  await client.connect();
  try {
    if (!(await databaseExists(client, target))) {
      await client.query(`create database ${quoteIdentifier(target)}`);
      console.log(JSON.stringify({ action: "create", database: target }));
    } else {
      console.log(JSON.stringify({ action: "exists", database: target }));
    }
  } finally {
    await client.end();
  }
}

async function dropDatabase(target) {
  const client = new Client({ connectionString: adminConnectionString(qaDatabaseUrl) });
  await client.connect();
  try {
    if (await databaseExists(client, target)) {
      await client.query("select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()", [target]);
      await client.query(`drop database ${quoteIdentifier(target)}`);
      console.log(JSON.stringify({ action: "drop", database: target }));
    } else {
      console.log(JSON.stringify({ action: "absent", database: target }));
    }
  } finally {
    await client.end();
  }
}

async function initializeSchema() {
  const files = (await readdir(migrationDirectory))
    .filter((file) => /^\d+_.*\.sql$/.test(file))
    .sort();
  const client = new Client({ connectionString: qaDatabaseUrl });
  await client.connect();
  try {
    for (const file of files) {
      await client.query(await readFile(join(migrationDirectory, file), "utf8"));
      console.log(`Applied ${file}`);
    }
  } finally {
    await client.end();
  }
}

async function status() {
  const pool = new Pool({ connectionString: qaDatabaseUrl });
  try {
    const result = await pool.query(`
      select
        (select count(*)::integer from files where unique_code like 'QA-PERF-%') as qa_files,
        (select count(*)::integer from files) as all_files,
        (select count(*)::integer from supply_orders so join files f on f.id = so.file_id where f.unique_code like 'QA-PERF-%') as qa_supply_orders
    `);
    console.log(JSON.stringify({ action: "status", database: databaseName(qaDatabaseUrl), ...result.rows[0] }, null, 2));
  } finally {
    await pool.end();
  }
}

async function main() {
  const target = assertSafeQaDatabase();
  if (action === "init") {
    await createDatabase(target);
    await initializeSchema();
  } else if (action === "status") {
    await status();
  } else if (action === "create") {
    await createDatabase(target);
  } else if (action === "drop") {
    await dropDatabase(target);
  } else {
    throw new Error(`Unknown QA_PERF_DB_ACTION: ${action}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
