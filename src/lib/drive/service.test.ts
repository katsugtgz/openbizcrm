import { describe, expect, it } from "vitest";
import { sanitizeFileName, DRIVE_QUOTA_BYTES } from "./service";

// Unit murni: bagian service yang bisa diuji tanpa DB/R2. Presign +
// confirmUpload diuji lewat service.integration (RUN_DB_TESTS=1 + R2).
describe("sanitizeFileName", () => {
  it("mengganti pemisah path dan blokir traversal", () => {
    expect(sanitizeFileName("a/b\\c.txt")).toBe("a-b-c.txt");
    // Traversal dipecah: hasil tak mengandung '..' maupun awalan '.'.
    const trav = sanitizeFileName("../../etc/passwd");
    expect(trav).not.toContain("..");
    expect(trav.startsWith(".")).toBe(false);
    expect(() => sanitizeFileName("..")).toThrow();
    expect(() => sanitizeFileName("")).toThrow();
  });

  it("membuang kontrol karakter dan batasi panjang", () => {
    expect(sanitizeFileName("do\u0000c.pdf")).toBe("doc.pdf");
    expect(sanitizeFileName("x".repeat(300)).length).toBe(200);
  });
});

describe("kuota", () => {
  it("10 GiB biner (bukan desimal)", () => {
    expect(DRIVE_QUOTA_BYTES).toBe(10 * 1024 ** 3);
  });
});
