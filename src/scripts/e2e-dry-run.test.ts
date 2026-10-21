import { afterEach, describe, expect, it, vi } from "vitest";
import { dryRun, type DryRunInput } from "../../scripts/e2e-dry-run";

afterEach(() => {
  vi.restoreAllMocks();
});

function inputFor(workflow: string): DryRunInput {
  return {
    repoRoot: "/fake",
    exists: (p) => {
      const n = p.replace(/\\/g, "/");
      return n.endsWith("src/app") || /(^|\/)bun\.lockb?$/.test(n);
    },
    readFile: (p) => {
      if (p.endsWith("ci.yml")) return workflow;
      throw new Error(`unexpected read: ${p}`);
    },
  };
}

function runQuiet(input: DryRunInput) {
  vi.spyOn(console, "log").mockImplementation(() => {});
  return dryRun(input);
}

function checkNames(result: ReturnType<typeof dryRun>) {
  return new Map(result.checks.map((c) => [c.name, c.pass]));
}

const VALID = `jobs:
  build:
    steps:
      - name: Upload build output
        uses: actions/upload-artifact@v7.0.2
        with:
          name: next-build
          path: .next/

  e2e-dry-run:
    steps:
      - name: Boot and probe
        run: |
          npx --no-install next start -p 3000 &
          for i in 1 2 3; do
            if curl -fsS -o /dev/null http://localhost:3000; then break; fi
          done
`;

describe("e2e-dry-run structural checks", () => {
  it("passes a minimal valid workflow", () => {
    const r = runQuiet(inputFor(VALID));
    expect(r.ok).toBe(true);
  });

  it("rejects markers that only appear in comments or quoted echo args", () => {
    const spoof = `jobs:
  build:
    steps:
      # name: next-build (commented out, must not count)
      - run: "echo name: next-build && echo 'next start'"

  e2e-dry-run:
    steps:
      - run: 'echo "next start" http://localhost:3000'
`;
    const r = runQuiet(inputFor(spoof));
    expect(r.ok).toBe(false);
    const checks = checkNames(r);
    expect(checks.get("ci.yml build job uploads next-build artifact")).toBe(
      false,
    );
    expect(
      checks.get("e2e-dry-run job boots 'next start' and smoke-tests :3000"),
    ).toBe(false);
  });

  it("rejects an unpaired artifact name (no upload-artifact step)", () => {
    const unpaired = VALID.replace(
      "uses: actions/upload-artifact@v7.0.2",
      "uses: actions/download-artifact@v7.0.2",
    );
    const r = runQuiet(inputFor(unpaired));
    const checks = checkNames(r);
    expect(checks.get("ci.yml build job uploads next-build artifact")).toBe(
      false,
    );
  });

  it("rejects unquoted echo of the boot command", () => {
    const echo = VALID.replace(
      "npx --no-install next start -p 3000 &",
      "echo next start -p 3000",
    );
    const r = runQuiet(inputFor(echo));
    const checks = checkNames(r);
    expect(
      checks.get("e2e-dry-run job boots 'next start' and smoke-tests :3000"),
    ).toBe(false);
  });
});
