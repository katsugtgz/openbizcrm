/**
 * Pure approval engine. No db/react imports — testable without infra.
 * Request state is an immutable value; act() functions return new state.
 */

export interface ApprovalStep {
  readonly approverId: string;
  readonly label?: string;
}

export type ApprovalChain = readonly ApprovalStep[];

export type ApprovalStatus = "pending" | "approved" | "rejected";

export interface ApprovalEvent {
  readonly type: "requested" | "approved" | "rejected";
  readonly actorId: string;
  readonly level: number; // chain index the event applies to (0 for requested)
  readonly note?: string;
  readonly at: string; // ISO timestamp
}

export interface ApprovalRequest {
  readonly requestId: string;
  readonly requestedBy: string;
  readonly chain: ApprovalChain;
  readonly status: ApprovalStatus;
  readonly level: number; // current pending chain index
  readonly events: readonly ApprovalEvent[];
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
  // Clone the caller's chain: later mutation of the caller's array must not
  // rewrite this request's immutable audit structure (deep freeze).
  return deepFreeze({
    requestId: input.requestId,
    requestedBy: input.requestedBy,
    chain: input.chain.map((step) => deepFreeze({ ...step })),
    status: "pending" as ApprovalStatus,
    level: 0,
    events: [
      deepFreeze({
        type: "requested" as const,
        actorId: input.requestedBy,
        level: 0,
        at: input.at ?? now(),
      }),
    ],
  });
}

/** Runtime counterpart of the readonly types: freezes recursively. */
function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const key of Object.keys(value as object)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
    Object.freeze(value);
  }
  return value;
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
