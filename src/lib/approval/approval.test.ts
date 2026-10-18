import { describe, it, expect } from "vitest";
import {
  createApproval,
  approve,
  reject,
  currentState,
  history,
  type ApprovalChain,
} from "./engine";

const oneLevel = (approverId: string): ApprovalChain => [
  { approverId, label: "Manager" },
];
const twoLevel = (a: string, b: string): ApprovalChain => [
  { approverId: a, label: "Manager" },
  { approverId: b, label: "Direktur" },
];

describe("approval engine", () => {
  it("happy path: single level approve finishes request", () => {
    let req = createApproval({
      requestId: "REQ-1",
      requestedBy: "u1",
      chain: oneLevel("u2"),
    });
    expect(req.status).toBe("pending");
    expect(currentState(req).currentApproverId).toBe("u2");
    req = approve(req, "u2", "oke");
    expect(req.status).toBe("approved");
    expect(req.events).toHaveLength(2); // requested + approved
  });

  it("multi-level: advances to next approver", () => {
    let req = createApproval({
      requestId: "REQ-2",
      requestedBy: "u1",
      chain: twoLevel("u2", "u3"),
    });
    req = approve(req, "u2");
    expect(req.status).toBe("pending");
    expect(currentState(req).currentApproverId).toBe("u3");
    expect(currentState(req).level).toBe(1);
    req = approve(req, "u3");
    expect(req.status).toBe("approved");
  });

  it("reject mid-chain is terminal", () => {
    let req = createApproval({
      requestId: "REQ-3",
      requestedBy: "u1",
      chain: twoLevel("u2", "u3"),
    });
    req = approve(req, "u2");
    req = reject(req, "u3", "tidak setuju");
    expect(req.status).toBe("rejected");
    expect(() => approve(req, "u2")).toThrow(/terminal/);
  });

  it("self-approval throws (chain must not contain requester)", () => {
    // Requester in chain rejected at createApproval; non-approver actor rejected at act().
    expect(() =>
      createApproval({
        requestId: "REQ-4",
        requestedBy: "u1",
        chain: oneLevel("u1"),
      }),
    ).toThrow(/pemohon/i);
    const req = createApproval({
      requestId: "REQ-4b",
      requestedBy: "u1",
      chain: oneLevel("u2"),
    });
    expect(() => approve(req, "u1")).toThrow(/Self-approval/);
  });

  it("non-current-approver throws", () => {
    const req = createApproval({
      requestId: "REQ-5",
      requestedBy: "u1",
      chain: twoLevel("u2", "u3"),
    });
    expect(() => approve(req, "u3")).toThrow(/bukan penyetuju/i);
    expect(() => reject(req, "u9")).toThrow(/bukan penyetuju/i);
  });

  it("act on terminal request throws", () => {
    let req = createApproval({
      requestId: "REQ-6",
      requestedBy: "u1",
      chain: oneLevel("u2"),
    });
    req = approve(req, "u2");
    expect(() => approve(req, "u2")).toThrow(/terminal/);
    expect(() => reject(req, "u2")).toThrow(/terminal/);
  });

  it("unknown actor throws", () => {
    const req = createApproval({
      requestId: "REQ-7",
      requestedBy: "u1",
      chain: oneLevel("u2"),
    });
    expect(() => approve(req, "nobody")).toThrow(/bukan penyetuju/i);
  });

  it("state is deeply frozen: status/level/events/chain immutable", () => {
    const chain = oneLevel("u2");
    const req = createApproval({
      requestId: "REQ-9",
      requestedBy: "u1",
      chain,
    });
    // caller cannot mutate the request afterward
    expect(Object.isFrozen(req)).toBe(true);
    expect(Object.isFrozen(req.events)).toBe(true);
    expect(Object.isFrozen(req.chain)).toBe(true);
    expect(Object.isFrozen(req.chain[0])).toBe(true);
    // createApproval cloned the caller's chain: the input array is untouched
    expect(Object.isFrozen(chain)).toBe(false);
    const after = history(req);
    expect(Object.isFrozen(after[0])).toBe(true);
    // status/level reflect the frozen initial state
    expect(req.status).toBe("pending");
    expect(req.level).toBe(0);
  });

  it("history is complete and ordered", () => {
    let req = createApproval({
      requestId: "REQ-8",
      requestedBy: "u1",
      chain: twoLevel("u2", "u3"),
    });
    req = approve(req, "u2", "setuju tahap 1");
    req = approve(req, "u3");
    const events = history(req);
    expect(events.map((e) => e.type)).toEqual([
      "requested",
      "approved",
      "approved",
    ]);
    expect(events[0].actorId).toBe("u1");
    expect(events[1].actorId).toBe("u2");
    expect(events[1].note).toBe("setuju tahap 1");
    expect(events[2].level).toBe(1);
    for (let i = 1; i < events.length; i++) {
      expect(new Date(events[i].at).getTime()).toBeGreaterThanOrEqual(
        new Date(events[i - 1].at).getTime(),
      );
    }
  });

  it("empty chain throws", () => {
    expect(() =>
      createApproval({ requestId: "REQ-9", requestedBy: "u1", chain: [] }),
    ).toThrow(/chain/i);
  });

  it("reject on pending level 0 is terminal", () => {
    let req = createApproval({
      requestId: "REQ-10",
      requestedBy: "u1",
      chain: twoLevel("u2", "u3"),
    });
    req = reject(req, "u2", "gak jadi");
    expect(req.status).toBe("rejected");
    expect(history(req)).toHaveLength(2);
  });

  it("requester in chain throws (would be stuck pending forever)", () => {
    expect(() =>
      createApproval({
        requestId: "REQ-11",
        requestedBy: "u1",
        chain: oneLevel("u2").concat([{ approverId: "u1" }]),
      }),
    ).toThrow(/pemohon/i);
    expect(() =>
      createApproval({
        requestId: "REQ-12",
        requestedBy: "u1",
        chain: oneLevel("u1"),
      }),
    ).toThrow(/pemohon/i);
  });
});
