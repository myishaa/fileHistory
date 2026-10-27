import { cp, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tsxBinary = join(repositoryRoot, "backend", "node_modules", ".bin", "tsx");
const mutationDatabaseUrl = process.env.MUTATION_DATABASE_URL ?? "postgresql://localhost/recordkeeper_mutation_test";

const mutations = [
  {
    name: "Delay threshold operator inversion",
    file: "backend/src/utils/file-search.ts",
    from: "const daysInStage = getDaysSinceDate(stageStartDate);\n    return daysInStage !== undefined && daysInStage > thresholdDays;",
    to: "const daysInStage = getDaysSinceDate(stageStartDate);\n    return daysInStage !== undefined && daysInStage < thresholdDays;",
    tests: ["tests/reports-delay-chronology.test.mjs", "tests/financial-sanction-delay-start.test.mjs"],
  },
  {
    name: "TCEC Supply Order received-date fallback",
    file: "backend/src/utils/file-search.ts",
    from: "return file.cncApprovalDate;",
    to: "return file.receivedDate;",
    tests: ["tests/financial-sanction-delay-start.test.mjs"],
  },
  {
    name: "Archive scope predicate removal",
    file: "backend/src/routes/files.ts",
    from: "if (!searchParams.includeArchivedYears) {",
    to: "if (false) {",
    tests: ["tests/analytics-firm-search-scope.test.mjs", "tests/milestone-bill-preparation-clickthrough.test.mjs"],
  },
  {
    name: "Supply Order placeholder-row regression",
    file: "backend/src/utils/report-summary.ts",
    from: ": rawSupplyOrders(file).map((order, orderIndex) => ({ order, orderIndex }))",
    to: ": expectedSupplyOrders(file).map((order, orderIndex) => ({ order, orderIndex }))",
    tests: ["tests/financial-sanction-delay-start.test.mjs"],
  },
];

async function makeSandbox() {
  const sandbox = await mkdtemp(join(tmpdir(), "recordkeeper-mutation-"));
  await cp(join(repositoryRoot, "backend", "src"), join(sandbox, "backend", "src"), { recursive: true });
  await cp(join(repositoryRoot, "src"), join(sandbox, "src"), { recursive: true });
  await cp(join(repositoryRoot, "tests"), join(sandbox, "tests"), { recursive: true });
  await symlink(join(repositoryRoot, "backend", "node_modules"), join(sandbox, "backend", "node_modules"), "junction");
  return sandbox;
}

async function runTests(sandbox, tests) {
  try {
    await execFileAsync(tsxBinary, ["--test", ...tests], {
      cwd: sandbox,
      env: {
        ...process.env,
        DATABASE_URL: mutationDatabaseUrl,
      },
      maxBuffer: 10 * 1024 * 1024,
    });
    return { passed: true };
  } catch (error) {
    return {
      passed: false,
      exitCode: error?.code ?? 1,
      output: `${error?.stdout ?? ""}${error?.stderr ?? ""}`.slice(-2000),
    };
  }
}

async function applyMutation(sandbox, mutation) {
  const target = join(sandbox, mutation.file);
  const source = await readFile(target, "utf8");
  const occurrences = source.split(mutation.from).length - 1;
  if (occurrences !== 1) {
    throw new Error(`${mutation.name}: expected one source occurrence, found ${occurrences}`);
  }
  await writeFile(target, source.replace(mutation.from, mutation.to));
}

async function main() {
  const sandbox = await makeSandbox();
  const results = [];
  try {
    const baselineTests = [...new Set(mutations.flatMap((mutation) => mutation.tests))];
    const baseline = await runTests(sandbox, baselineTests);
    if (!baseline.passed) {
      throw new Error(`Mutation baseline failed before any mutation was applied.\n${baseline.output}`);
    }
    for (const mutation of mutations) {
      const mutationSandbox = await makeSandbox();
      try {
        await applyMutation(mutationSandbox, mutation);
        const result = await runTests(mutationSandbox, mutation.tests);
        results.push({
          name: mutation.name,
          status: result.passed ? "SURVIVED" : "KILLED",
          ...(result.passed ? {} : { exitCode: result.exitCode }),
        });
      } finally {
        await rm(mutationSandbox, { recursive: true, force: true });
      }
    }
  } finally {
    await rm(sandbox, { recursive: true, force: true });
  }
  const survived = results.filter((result) => result.status === "SURVIVED");
  console.log(JSON.stringify({
    mutationCount: results.length,
    killed: results.filter((result) => result.status === "KILLED").length,
    survived: survived.length,
    results,
  }, null, 2));
  if (survived.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
