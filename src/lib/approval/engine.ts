/**
 * Pure approval engine. No db/react imports — testable without infra.
 * Request state is an immutable value; act() functions return new state.
 */

export interface ApprovalStep {
  approverId: string;
  label?: string;
}

export type ApprovalChain = readonly ApprovalStep[];

export type ApprovalStatus = "pending" | "approved" | "rejected";

export interface ApprovalEvent {
  type: "requested" | "approved" | "rejected";
  actorId: string;
  level: number; // chain index the event applies to (0 for requested)
  note?: string;
  at: string; // ISO timestamp
}

export interface ApprovalRequest {
  requestId: string;
  requestedBy: string;
  chain: ApprovalChain;
  status: ApprovalStatus;
  level: number; // current pending chain index
  events: readonly ApprovalEvent[];
}

export interface ApprovalCurrentState {
  status: ApprovalStatus;
  level: number;
  currentApproverId: string | null; // null when terminal
}

export class ApprovalError extends Error {}

function now(): string {
  return new Date().toISOString();
}

export function createApproval(input: {
  requestId: string;
  requestedBy: string;
  chain: ApprovalChain;
  at?: string;
}): ApprovalRequest {
  if (input.chain.length === 0) {
    throw new ApprovalError("Approval chain tidak boleh kosong.");
  }
  // Pemohon dalam rantai tidak pernah bisa approve (larangan self-approval),
  // jadi request akan terjebak pending selamanya — tolak sejak awal.
  if (input.chain.some((s) => s.approverId === input.requestedBy)) {
    throw new ApprovalError(
      "Pemohon tidak boleh menjadi bagian dari rantai persetujuan.",
    );
  }
  return {
    requestId: input.requestId,
    requestedBy: input.requestedBy,
    chain: input.chain,
    status: "pending",
    level: 0,
    events: [
      {
        type: "requested",
        actorId: input.requestedBy,
        level: 0,
        at: input.at ?? now(),
      },
    ],
  };
}

export function currentState(req: ApprovalRequest): ApprovalCurrentState {
  const done = req.status !== "pending";
  return {
    status: req.status,
    level: req.level,
    currentApproverId: done ? null : req.chain[req.level].approverId,
  };
}

export function history(req: ApprovalRequest): readonly ApprovalEvent[] {
  return req.events;
}

function act(
  req: ApprovalRequest,
  type: "approved" | "rejected",
  actorId: string,
  note?: string,
): ApprovalRequest {
  if (req.status !== "pending") {
    throw new ApprovalError(
      `Request sudah terminal (status: ${req.status}); tidak bisa diact lagi.`,
    );
  }
  if (actorId === req.requestedBy) {
    throw new ApprovalError(
      "Self-approval dilarang: pemohon tidak boleh menyetujui sendiri.",
    );
  }
  const expected = req.chain[req.level].approverId;
  if (actorId !== expected) {
    throw new ApprovalError(
      `${actorId} bukan penyetuju saat ini (harusnya: ${expected}).`,
    );
  }
  const event: ApprovalEvent = {
    type,
    actorId,
    level: req.level,
    note,
    at: now(),
  };
  if (type === "rejected") {
    return { ...req, status: "rejected", events: [...req.events, event] };
  }
  const last = req.level === req.chain.length - 1;
  return {
    ...req,
    status: last ? "approved" : "pending",
    level: last ? req.level : req.level + 1,
    events: [...req.events, event],
  };
}

export function approve(
  req: ApprovalRequest,
  actorId: string,
  note?: string,
): ApprovalRequest {
  return act(req, "approved", actorId, note);
}

export function reject(
  req: ApprovalRequest,
  actorId: string,
  note?: string,
): ApprovalRequest {
  return act(req, "rejected", actorId, note);
}
