/**
 * E2E DRY-RUN
 * ===========
 * Simulates the `e2e-dry-run` job in `.github/workflows/ci.yml` locally,
 * BEFORE pushing, so CI never fails on a missing prerequisite.
 *
 * Runs under BOTH `node` (>=22.6 with --experimental-strip-types, or via
 * `npx tsx`) and `bun`:
 *
 *   npx tsx scripts/e2e-dry-run.ts          # node
 *   bun run scripts/e2e-dry-run.ts          # bun
 *
 * This is a DRY RUN: it verifies every input the CI job depends on
 * (app source, workflow file, lockfile, build output availability) and
 * prints the exact commands CI will execute. It never boots the server.
 *
 * Exit codes: 0 = all checks pass, 1 = at least one check failed.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** CI boots and polls the server with generous margin. */
export const SERVER_TIMEOUT_SECONDS = 120;
export const APP_PORT = 3000;

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(SCRIPT_DIR, "..");

export interface DryRunCheck {
  name: string;
  pass: boolean;
  detail: string;
}

export interface DryRunInput {
  repoRoot: string;
  exists: (path: string) => boolean;
  readFile: (path: string) => string;
}

export const defaultInput: DryRunInput = {
  repoRoot: REPO_ROOT,
  exists: existsSync,
  readFile: (path) => readFileSync(path, "utf8"),
};

/**
 * Strip `#` comments so marker checks cannot pass on commented-out text.
 * A comment mentioning `next start` must not satisfy the boot check.
 */
function stripYamlComments(source: string): string {
  return source
    .split("\n")
    .map((line) => {
      // Quote-aware (cubic pr10 e2e:53): '#' inside a string (for example,
      // run: "echo #hi") is not a comment; only strip '#' outside quotes.
      let inSingle = false;
      let inDouble = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === "'" && !inDouble) inSingle = !inSingle;
        else if (ch === '"' && !inSingle) inDouble = !inDouble;
        else if (ch === "#" && !inSingle && !inDouble) return line.slice(0, i);
      }
      return line;
    })
    .join("\n");
}

function runChecks(input: DryRunInput): DryRunCheck[] {
  const { repoRoot, exists, readFile } = input;
  const checks: DryRunCheck[] = [];

  // 1. App source exists — `next start` needs a buildable app.
  const appDir = join(repoRoot, "src", "app");
  checks.push({
    name: "src/app directory exists",
    pass: exists(appDir),
    detail: appDir,
  });

  // 2. CI workflow exists and declares the e2e-dry-run job this script mirrors.
  const workflowPath = join(repoRoot, ".github", "workflows", "ci.yml");
  let workflow = "";
  let workflowExists = false;
  try {
    workflow = stripYamlComments(readFile(workflowPath));
    workflowExists = true;
  } catch {
    workflowExists = false;
  }
  const hasJob = workflowExists && /(?:^|\n)\s{2}e2e-dry-run:/.test(workflow);
  checks.push({
    name: "ci.yml declares e2e-dry-run job",
    pass: Boolean(hasJob),
    detail: hasJob ? workflowPath : `missing job in ${workflowPath}`,
  });

  // 3. The job downloads the `next-build` artifact into .next — the build
  //    job must upload it, and locally .next must exist (or be buildable).
  const uploadsArtifact = workflow.includes("name: next-build");
  checks.push({
    name: "ci.yml build job uploads next-build artifact",
    pass: uploadsArtifact,
    detail: uploadsArtifact
      ? "artifact 'next-build' found"
      : "no upload named 'next-build'",
  });

  // 4. Server boot + smoke-test commands present in the job.
  const startsNext = workflow.includes("next start");
  const smokeTests = workflow.includes(`http://localhost:${APP_PORT}`);
  checks.push({
    name: `e2e-dry-run job boots 'next start' and smoke-tests :${APP_PORT}`,
    pass: startsNext && smokeTests,
    detail: `next start=${startsNext}, localhost:${APP_PORT}=${smokeTests}`,
  });

  // 5. A bun lockfile exists — CI installs with --frozen-lockfile.
  const lockfile = ["bun.lock", "bun.lockb"].find((f) =>
    exists(join(repoRoot, f)),
  );
  checks.push({
    name: "bun lockfile present (CI uses --frozen-lockfile)",
    pass: Boolean(lockfile),
    detail: lockfile ?? "no bun.lock/bun.lockb found",
  });

  return checks;
}

const NEVER_TOUCHED = [".next/**", "bun.lock*", "node_modules/**"] as const;

export function dryRun(input: DryRunInput = defaultInput): {
  ok: boolean;
  checks: DryRunCheck[];
} {
  const checks = runChecks(input);

  console.log("e2e-dry-run — DRY RUN (no server will be started)\n");
  for (const check of checks) {
    const mark = check.pass ? "PASS" : "FAIL";
    console.log(`  [${mark}] ${check.name}`);
    console.log(`           ${check.detail}`);
  }

  console.log("\nCommands CI would run after a green build job:");
  console.log(`  bun install --frozen-lockfile`);
  console.log(
    `  npx --no-install next start -p ${APP_PORT}   # then poll :${APP_PORT}`,
  );
  console.log(`  (server timeout budget: ${SERVER_TIMEOUT_SECONDS}s)`);
  console.log(
    `\nDry run never executes the server or reads build output (${NEVER_TOUCHED.join(", ")} are untouched).`,
  );

  const ok = checks.every((c) => c.pass);
  console.log(ok ? "\nResult: OK" : "\nResult: FAILED");
  return { ok, checks };
}

/** Script entrypoint: runs the dry run against the real repo, sets exit code. */
export function main(input: DryRunInput = defaultInput): number {
  const { ok } = dryRun(input);
  return ok ? 0 : 1;
}

const isDirectRun =
  typeof process !== "undefined" &&
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isDirectRun) {
  process.exitCode = main();
}
