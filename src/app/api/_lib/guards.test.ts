import { describe, it, expect, beforeEach } from "vitest";
import {
  __resetRateLimits,
  checkRateLimit,
  endTurn,
  isAllowedOrigin,
  isInsecureGatewayUrl,
  isUuid,
  toDomainErrorResponse,
  tryBeginTurn,
} from "./guards";
import { NotFoundError, OrgScopeError } from "@/lib/org-scope";
import { PayrollError } from "@/lib/payroll/service";

describe("isUuid", () => {
  it("menerima UUID kanonis", () => {
    expect(isUuid("550e8400-e29b-41d4-a716-446655440000")).toBe(true);
  });

  it("menolak string injeksi header/SQL", () => {
    expect(isUuid('x";\r\nFoo: bar')).toBe(false);
    expect(isUuid("1' OR '1'='1")).toBe(false);
    expect(isUuid("")).toBe(false);
    expect(isUuid("550e8400-e29b-41d4-a716")).toBe(false);
  });
});

describe("checkRateLimit", () => {
  beforeEach(() => __resetRateLimits());

  it("mengizinkan sampai limit lalu 429", () => {
    expect(checkRateLimit("k", 2, 60_000, 0).ok).toBe(true);
    expect(checkRateLimit("k", 2, 60_000, 1).ok).toBe(true);
    const hit = checkRateLimit("k", 2, 60_000, 2);
    expect(hit.ok).toBe(false);
    expect(hit.retryAfterSec).toBeGreaterThan(0);
  });

  it("window baru me-reset hitungan", () => {
    checkRateLimit("k", 1, 100, 0);
    expect(checkRateLimit("k", 1, 100, 50).ok).toBe(false);
    expect(checkRateLimit("k", 1, 100, 101).ok).toBe(true);
  });

  it("key berbeda punya bucket sendiri", () => {
    checkRateLimit("a", 1, 60_000, 0);
    expect(checkRateLimit("b", 1, 60_000, 0).ok).toBe(true);
  });
});

describe("isAllowedOrigin", () => {
  const req = (headers: Record<string, string>) =>
    new Request("https://app.example/api/ai/chat", { headers });

  it("tanpa Origin/Referer lolos (non-browser)", () => {
    expect(isAllowedOrigin(req({}))).toBe(true);
  });

  it("Origin seasal lolos", () => {
    expect(isAllowedOrigin(req({ origin: "https://app.example" }))).toBe(true);
  });

  it("Origin lintas-asal ditolak", () => {
    expect(isAllowedOrigin(req({ origin: "https://evil.example" }))).toBe(
      false,
    );
  });

  it("Referer lintas-asal ditolak", () => {
    expect(isAllowedOrigin(req({ referer: "https://evil.example/p" }))).toBe(
      false,
    );
  });
});

describe("turn lock", () => {
  it("turn kedua konkuren ditolak sampai selesai", () => {
    const id = "550e8400-e29b-41d4-a716-446655440000";
    expect(tryBeginTurn(id)).toBe(true);
    expect(tryBeginTurn(id)).toBe(false);
    endTurn(id);
    expect(tryBeginTurn(id)).toBe(true);
    endTurn(id);
  });
});

describe("isInsecureGatewayUrl", () => {
  it("https aman", () => {
    expect(isInsecureGatewayUrl("https://gw.example/v1")).toBe(false);
  });

  it("http loopback diizinkan (dev lokal)", () => {
    expect(isInsecureGatewayUrl("http://localhost:11434/v1")).toBe(false);
    expect(isInsecureGatewayUrl("http://127.0.0.1:11434/v1")).toBe(false);
  });

  it("http non-loopback tidak aman", () => {
    expect(isInsecureGatewayUrl("http://gw.example/v1")).toBe(true);
  });

  it("URL tidak valid ditolak", () => {
    expect(isInsecureGatewayUrl("bukan-url")).toBe(true);
  });
});

describe("toDomainErrorResponse", () => {
  it("OrgScopeError => 403", () => {
    const res = toDomainErrorResponse(
      new OrgScopeError("INSUFFICIENT_ROLE", "x"),
    );
    expect(res?.status).toBe(403);
  });

  it("NotFoundError => 404", () => {
    expect(toDomainErrorResponse(new NotFoundError())?.status).toBe(404);
  });

  it("PayrollError NOT_FOUND => 404, lainnya 400", () => {
    expect(
      toDomainErrorResponse(new PayrollError("NOT_FOUND", "x"))?.status,
    ).toBe(404);
    expect(
      toDomainErrorResponse(new PayrollError("DUPLICATE_PERIOD", "x"))?.status,
    ).toBe(400);
  });

  it("error tak dikenal => null", () => {
    expect(toDomainErrorResponse(new Error("boom"))).toBeNull();
  });
});
