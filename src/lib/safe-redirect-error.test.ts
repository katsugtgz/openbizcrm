import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { OrgScopeError } from "./org-scope";
import { ValidationError, safeRedirectError } from "./safe-redirect-error";

describe("safeRedirectError", () => {
  it("reflects typed ValidationError messages", () => {
    expect(
      safeRedirectError(
        new ValidationError("Nomor karyawan wajib diisi."),
        "Gagal menyimpan karyawan.",
      ),
    ).toBe("Nomor karyawan wajib diisi.");
  });

  it("reflects ValidationError subclass messages", () => {
    class CustomError extends ValidationError {}
    expect(
      safeRedirectError(new CustomError("Alasan khusus."), "fallback"),
    ).toBe("Alasan khusus.");
  });

  it("maps OrgScopeError to access-denied", () => {
    expect(
      safeRedirectError(
        new OrgScopeError("INSUFFICIENT_ROLE", "butuh admin"),
        "fallback",
      ),
    ).toBe("Akses ditolak.");
  });

  it("maps plain and driver errors to the fallback", () => {
    expect(safeRedirectError(new Error("nope"), "fallback")).toBe("fallback");
    const driver = Object.assign(new Error("duplicate key value"), {
      code: "23505",
      detail: "Key (email)=(a@b.c) already exists.",
    });
    expect(safeRedirectError(driver, "fallback")).toBe("fallback");
  });

  it("only static literals are passed to new ValidationError", () => {
    // Structural enforcement (cubic pr10 r4): the whitelist's guarantee
    // is that reflected text is developer-authored. Any template-literal
    // construction could interpolate user-controlled data into ?error=.
    const root = process.cwd(); // vitest runs from the repo root
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) {
          walk(p);
          continue;
        }
        if (!/\.tsx?$/.test(name)) continue;
        const src = readFileSync(p, "utf8");
        const re = /new ValidationError\(\s*`/g;
        if (re.test(src)) offenders.push(p);
      }
    };
    walk(join(root, "src"));
    expect(offenders).toEqual([]);
  });

  it("InsufficientBalanceError interpolates server-computed values only", () => {
    // The single dynamic whitelisted message: day counts and a fixed
    // label — never user-supplied strings.
    const root = process.cwd(); // vitest runs from the repo root
    const src = readFileSync(join(root, "src/lib/leave/repo.ts"), "utf8");
    const m = /new InsufficientBalanceError\(\s*`([^`]*)`/.exec(src);
    expect(m).not.toBeNull();
    const holes = [...m![1].matchAll(/\$\{([^}]*)\}/g)].map((h) => h[1]);
    expect(holes.length).toBeGreaterThan(0);
    for (const h of holes) {
      expect(["label", "days", "existing[field]"]).toContain(h);
    }
  });
});
