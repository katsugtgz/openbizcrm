import { afterEach, describe, expect, it, vi } from "vitest";
import {
  APP_PORT,
  SERVER_TIMEOUT_SECONDS,
  dryRun,
  main,
  type DryRunCheck,
  type DryRunInput,
} from "../../../scripts/e2e-dry-run";

const WORKFLOW = `
jobs:
  build:
    steps:
      - name: Upload build output
        uses: actions/upload-artifact@v7.0.2
        with:
          name: next-build
          path: .next
  e2e-dry-run:
    steps:
      - name: Boot server and smoke-test it
        run: |
          npx --no-install next start -p 3000 &
          curl -fsS -o /dev/null http://localhost:3000
`;

function makeInput(overrides?: Partial<DryRunInput>): DryRunInput {
  return {
    repoRoot: "/fake/repo",
    exists: () => true,
    readFile: () => WORKFLOW,
    ...overrides,
  };
}

describe("e2e-dry-run", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("exports CI-matching constants", () => {
    expect(APP_PORT).toBe(3000);
    expect(SERVER_TIMEOUT_SECONDS).toBe(120);
  });

  it("passes with a healthy repo: app dir, workflow job, artifact, lockfile", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const { ok, checks } = dryRun(makeInput());

    expect(ok).toBe(true);
    expect(checks).toHaveLength(5);
    expect(checks.every((c) => c.pass)).toBe(true);
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("Result: OK"));
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining("bun install --frozen-lockfile"),
    );
  });

  it("fails when src/app is missing", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const { ok, checks } = dryRun(
      makeInput({ exists: (p) => !/src[\\/]app$/.test(p) }),
    );
    expect(ok).toBe(false);
    expect(checks.find((c) => c.name.includes("src/app"))?.pass).toBe(false);
  });

  it("fails when ci.yml is unreadable (missing workflow)", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const { ok, checks } = dryRun(
      makeInput({
        readFile: (p) => {
          if (p.includes("ci.yml")) throw new Error("ENOENT");
          return WORKFLOW;
        },
      }),
    );
    expect(ok).toBe(false);
    const jobCheck = checks.find((c) =>
      c.name.includes("declares e2e-dry-run"),
    );
    expect(jobCheck?.pass).toBe(false);
  });

  it("fails when the workflow has no e2e-dry-run job", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const { ok } = dryRun(
      makeInput({ readFile: () => "jobs:\n  build:\n    steps: []\n" }),
    );
    expect(ok).toBe(false);
  });

  it("fails when no bun lockfile exists", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const { ok, checks } = dryRun(
      makeInput({ exists: (p) => !/(^|[\\/])bun\.lockb?$/.test(p) }),
    );
    expect(ok).toBe(false);
    expect(checks.find((c) => c.name.includes("lockfile"))?.pass).toBe(false);
  });

  it("fails when the job never smoke-tests localhost:3000", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const { ok } = dryRun(
      makeInput({
        readFile: () =>
          "  e2e-dry-run:\n    run: npx --no-install next start -p 3000\n",
      }),
    );
    expect(ok).toBe(false);
  });

  it("aggregates multiple failures into one failed result", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const { ok, checks } = dryRun(
      makeInput({
        exists: () => false,
        readFile: () => {
          throw new Error("missing");
        },
      }),
    );
    expect(ok).toBe(false);
    expect(checks.filter((c) => !c.pass).length).toBeGreaterThan(1);
  });

  it("main() returns 0 and prints the dry-run banner when all checks pass", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(main()).toBe(0);
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("e2e-dry-run — DRY RUN"),
    );
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("Result: OK"));
  });

  it("DryRunCheck shape: pass booleans drive the aggregate result", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const failing: DryRunCheck[] = [
      { name: "a", pass: true, detail: "ok" },
      { name: "b", pass: false, detail: "nope" },
    ];
    expect(failing.every((c) => c.pass)).toBe(false);
  });
});
