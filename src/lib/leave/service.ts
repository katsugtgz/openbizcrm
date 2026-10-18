/**
 * Pure leave service. Leave requests wrap the generic approval engine;
 * quota uses the Indonesian mid-year proration rule: requests starting
 * before July 1 draw from the first-half bucket (usedBeforeMidYear),
 * after July 1 from the annual pool minus first-half usage.
 */
import {
  createApproval,
  approve as engineApprove,
  reject as engineReject,
  type ApprovalRequest,
  type ApprovalChain,
} from "@/lib/approval";

export const MID_YEAR_DATE = { month: 6, date: 1 }; // 0-indexed: July 1

export type LeaveType = "cuti" | "izin" | "sakit" | "wfh";

export interface LeaveQuota {
  annual: number;
  usedBeforeMidYear: number;
  usedAfterMidYear: number;
}

export interface LeaveRequestInput {
  requestId: string;
  orgId: string;
  requesterId: string;
  type: LeaveType;
  startDate: string; // "YYYY-MM-DD"
  endDate: string;
  /** Durasi hari kalender; wajib konsisten dengan rentang tanggal. */
  days: number;
  chain: ApprovalChain;
}

export interface LeaveRequest {
  requestId: string;
  orgId: string;
  requesterId: string;
  type: LeaveType;
  startDate: string;
  endDate: string;
  days: number;
  status: "pending" | "approved" | "rejected";
  approval: ApprovalRequest;
}

/**
 * Cuti default Juli-November; Jan-Jun dan Desember default izin.
 * Flag eksplisit menang.
 */
export function inferType(input: {
  isPermission?: boolean;
  date?: string;
}): LeaveType {
  if (input.isPermission !== undefined) {
    return input.isPermission ? "izin" : "cuti";
  }
  if (!input.date) return "izin";
  const m = Number(input.date.slice(5, 7));
  return m >= 7 && m <= 11 ? "cuti" : "izin";
}

/** Hari kalender inklusif; terbalik atau <= 0 => 0. */
export function computeDuration(start: string, end: string): number {
  const a = new Date(`${start}T00:00:00Z`).getTime();
  const b = new Date(`${end}T00:00:00Z`).getTime();
  const diff = Math.round((b - a) / 86_400_000) + 1;
  return diff > 0 ? diff : 0;
}

export function createLeaveRequest(input: LeaveRequestInput): LeaveRequest {
  const days = input.days ?? computeDuration(input.startDate, input.endDate);
  if (days <= 0) {
    throw new Error("Durasi cuti/izin harus lebih dari 0 hari.");
  }
  if (computeDuration(input.startDate, input.endDate) !== days) {
    throw new Error("Durasi tidak konsisten dengan rentang tanggal.");
  }
  const approval = createApproval({
    requestId: input.requestId,
    requestedBy: input.requesterId,
    chain: input.chain,
  });
  return {
    requestId: input.requestId,
    orgId: input.orgId,
    requesterId: input.requesterId,
    type: input.type,
    startDate: input.startDate,
    endDate: input.endDate,
    days,
    status: "pending",
    approval,
  };
}

function act(
  req: LeaveRequest,
  actorId: string,
  action: "approve" | "reject",
  note?: string,
): LeaveRequest {
  const next =
    action === "approve"
      ? engineApprove(req.approval, actorId, note)
      : engineReject(req.approval, actorId, note);
  return { ...req, status: next.status, approval: next };
}

export function actLeave(
  req: LeaveRequest,
  actorId: string,
  note?: string,
): LeaveRequest {
  return act(req, actorId, "approve", note);
}

export function rejectLeave(
  req: LeaveRequest,
  actorId: string,
  note?: string,
): LeaveRequest {
  return act(req, actorId, "reject", note);
}

/**
 * Kuota cuti terpakai = baseline (usedBeforeMidYear + usedAfterMidYear) plus
 * durasi request type cuti yang dilewatkan (izin tidak memotong kuota cuti;
 * status difilter upstream oleh pemanggil). remaining di-floor di 0.
 */
export function computeBalance(
  quota: LeaveQuota,
  requests: LeaveRequest[],
): LeaveQuota & { used: number; remaining: number } {
  let used = quota.usedBeforeMidYear + quota.usedAfterMidYear;
  for (const r of requests) {
    if (r.type === "cuti") {
      used += r.days;
    }
  }
  const remaining = Math.max(0, quota.annual - used);
  return { ...quota, used, remaining };
}
