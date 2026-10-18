import { describe, it, expect } from "vitest";
import {
  inferType,
  computeDuration,
  createLeaveRequest,
  computeBalance,
  MID_YEAR_DATE,
  type LeaveRequest,
  type LeaveQuota,
} from "./service";
import { ApprovalError } from "@/lib/approval";

/** Shared fixture — same shape as LeaveRequestInput. */
const base = (id: string) => ({
  requestId: id,
  orgId: "org-1",
  requesterId: "u1",
  type: "cuti" as const,
  startDate: "2026-08-01",
  endDate: "2026-08-03",
  days: 3,
  chain: [{ approverId: "admin-1", label: "Atasan" }],
});

describe("leave type inference", () => {
  it("infers izin from explicit flag", () => {
    expect(inferType({ isPermission: true })).toBe("izin");
    expect(inferType({ isPermission: false })).toBe("cuti");
  });

  it("mid-year boundary: Jul-Nov is cuti; Jan-Jun and Dec default to izin", () => {
    expect(inferType({ date: "2026-07-01" })).toBe("cuti");
    expect(inferType({ date: "2026-06-30" })).toBe("izin");
    expect(inferType({ date: "2026-09-15" })).toBe("cuti");
    expect(inferType({ date: "2026-11-30" })).toBe("cuti");
    expect(inferType({ date: "2025-12-31" })).toBe("izin");
    expect(inferType({ date: "2026-01-05" })).toBe("izin");
  });

  it("izin on/after July 1 when forced is allowed; explicit beats date", () => {
    expect(inferType({ isPermission: true, date: "2026-08-01" })).toBe("izin");
    expect(inferType({ isPermission: false, date: "2026-01-01" })).toBe("cuti");
  });
});

describe("duration", () => {
  it("counts inclusive calendar days", () => {
    expect(computeDuration("2026-08-01", "2026-08-01")).toBe(1);
    expect(computeDuration("2026-08-01", "2026-08-05")).toBe(5);
    expect(computeDuration("2026-08-05", "2026-08-01")).toBe(0);
  });
});

describe("request lifecycle", () => {
  const approver = { approverId: "admin-1", label: "Atasan" };
  const base = (id: string) => ({
    requestId: id,
    orgId: "org-1",
    requesterId: "u1",
    type: "cuti" as const,
    startDate: "2026-08-01",
    endDate: "2026-08-03",
    days: 3,
    chain: [approver],
  });

  it("creates a pending request wired to the approval engine", () => {
    const req = createLeaveRequest(base("LV-1"));
    expect(req.type).toBe("cuti");
    expect(req.status).toBe("pending");
    expect(req.days).toBe(3);
    expect(req.approval.requestId).toBe("LV-1");
  });

  it("rejects non-positive duration", () => {
    expect(() => createLeaveRequest({ ...base("LV-2"), days: 0 })).toThrow(
      /durasi/i,
    );
  });

  it("rejects reversed dates", () => {
    expect(() =>
      createLeaveRequest({
        ...base("LV-3"),
        startDate: "2026-08-05",
        endDate: "2026-08-01",
      }),
    ).toThrow(/durasi/i);
  });

  it("acts through the approval engine (reject is terminal)", () => {
    let req = createLeaveRequest(base("LV-4"));
    expect(() => reqAct(req, "u1", "approve")).toThrow(ApprovalError); // self-approve
    req = reqAct(req, "admin-1", "reject", "tidak ada pengganti");
    expect(req.status).toBe("rejected");
    expect(() => reqAct(req, "admin-1", "approve")).toThrow(/terminal/);
  });
});

// Thin wrapper so tests exercise the same code path the actions will.
function reqAct(
  req: LeaveRequest,
  actorId: string,
  action: "approve" | "reject",
  note?: string,
) {
  const fn = action === "approve" ? actLeave : rejectLeave;
  return fn(req, actorId, note);
}
import { actLeave, rejectLeave } from "./service";

describe("mid-year quota", () => {
  const quota = (usedBefore: number, usedAfter: number): LeaveQuota => ({
    annual: 12,
    usedBeforeMidYear: usedBefore,
    usedAfterMidYear: usedAfter,
  });

  it("adds approved cuti since July 1 on top of the recorded baseline", () => {
    const cutiAfter = {
      ...base("LV-5"),
      startDate: "2026-07-10",
      endDate: "2026-07-12",
      days: 3,
    };
    // Kontrak: pemanggil memfilter status/type — repo hanya pass approved cuti.
    expect(
      computeBalance(quota(4, 0), [createLeaveRequest(cutiAfter)]),
    ).toMatchObject({
      used: 7,
      remaining: 5,
    });
  });

  it("remaining floors at zero when usage overdraws the quota", () => {
    expect(computeBalance(quota(14, 0), []).remaining).toBe(0);
  });

  it("counts the caller-supplied baseline plus passed requests; filter status upstream", () => {
    const cuti = {
      ...base("LV-9"),
      startDate: "2026-08-01",
      endDate: "2026-08-05",
      days: 5,
    };
    expect(
      computeBalance(quota(12, 0), [createLeaveRequest(cuti)]),
    ).toMatchObject({
      used: 17,
      remaining: 0,
    });
  });
});

describe("MID_YEAR_DATE constant", () => {
  it("is July 1", () => {
    expect(MID_YEAR_DATE.month).toBe(6); // 0-indexed
    expect(MID_YEAR_DATE.date).toBe(1);
  });
});
