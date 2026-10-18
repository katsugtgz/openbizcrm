"use server";

import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  approvalRequests,
  leaveRequests as leaveRequestsTable,
  users as schemaUsers,
} from "@/db/schema";
import { session } from "@/lib/auth";
import { requireOrgRole } from "@/lib/org-scope";
import { saveApprovalRequest } from "@/lib/approval/store";
import {
  approve as approveApproval,
  reject as rejectApproval,
} from "@/lib/approval";
import {
  createLeaveRequest,
  inferType,
  computeDuration,
} from "@/lib/leave/service";
import {
  createLeave,
  getOrCreateBalance,
  debitBalance,
  getEmployeeByUser,
} from "@/lib/leave/repo";
import { listMembers } from "@/lib/repos/member-repo";
import { recordAudit } from "@/lib/repos/audit-repo";

async function requireSession() {
  const user = await session.getSession();
  if (!user) redirect("/login");
  const orgId =
    user.organizationId ??
    (
      await db
        .select({ orgId: schemaUsers.currentOrgId })
        .from(schemaUsers)
        .where(eq(schemaUsers.id, user.id))
        .limit(1)
    )[0]?.orgId;
  if (!orgId) throw new Error("Tidak ada organisasi aktif.");
  return { user, orgId };
}

/**
 * Ajukan cuti/izin. Auto-detect izin/cuti dari tanggal (mid-year rule)
 * kecuali user paksa via `type`.
 */
export async function submitLeaveAction(formData: FormData): Promise<void> {
  const { user, orgId } = await requireSession();
  await requireOrgRole(user.id, orgId, "member");

  const startDate = String(formData.get("startDate") ?? "");
  const endDate = String(formData.get("endDate") ?? "");
  const reason = String(formData.get("reason") ?? "").trim() || null;
  const typeRaw = String(formData.get("type") ?? "");
  const forcedType =
    typeRaw === "izin" || typeRaw === "cuti" ? typeRaw : undefined;

  try {
    if (!startDate || !endDate) {
      throw new Error("Tanggal mulai dan selesai wajib diisi.");
    }

    const employee = await getEmployeeByUser(user.id, orgId);
    if (!employee) throw new Error("Profil karyawan tidak ditemukan.");

    const days = computeDuration(startDate, endDate);
    if (days <= 0) throw new Error("Rentang tanggal tidak valid.");

    // Rantai approval: satu admin/owner org lain (bukan pemohon).
    const approver = (await listMembers(orgId))
      .map((m) => m.user)
      .find((u) => u.id !== user.id);
    if (!approver) {
      throw new Error("Tidak ada approver lain di organisasi ini.");
    }

    const requestId = `LV-${crypto.randomUUID()}`;
    const type = inferType({
      isPermission:
        forcedType === "izin"
          ? true
          : forcedType === "cuti"
            ? false
            : undefined,
      date: startDate,
    });

    const approval = createLeaveRequest({
      requestId,
      orgId,
      requesterId: user.id,
      type,
      startDate,
      endDate,
      days,
      chain: [{ approverId: approver.id, label: approver.name ?? "Atasan" }],
    });

    const { id: approvalId } = await saveApprovalRequest(
      orgId,
      approval.approval,
    );
    await createLeave(user.id, orgId, {
      employeeId: employee.id,
      type,
      startDate,
      endDate,
      reason,
      approvalId,
    });

    await recordAudit({
      orgId,
      userId: user.id,
      action: "leave.submit",
      entity: "leave_request",
      entityId: requestId,
      metadata: { type, startDate, endDate, days },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Terjadi kesalahan.";
    redirect(`/cuti?error=${encodeURIComponent(message)}`);
  }
  redirect(`/cuti?ok=${encodeURIComponent("Pengajuan cuti/izin terkirim.")}`);
}

/** Setujui atau tolak permintaan (approver saat ini di rantai). */
export async function actLeaveAction(formData: FormData): Promise<void> {
  const { user, orgId } = await requireSession();
  await requireOrgRole(user.id, orgId, "member");

  const approvalRowId = String(formData.get("approvalId") ?? "");
  const decision = String(formData.get("decision") ?? "");
  const note = String(formData.get("note") ?? "").trim() || undefined;
  try {
    if (!approvalRowId || (decision !== "approve" && decision !== "reject")) {
      throw new Error("Keputusan tidak valid.");
    }

    const [row] = await db
      .select({
        state: approvalRequests.state,
        requestId: approvalRequests.requestId,
        employeeId: leaveRequestsTable.employeeId,
        leaveType: leaveRequestsTable.type,
        startDate: leaveRequestsTable.startDate,
        endDate: leaveRequestsTable.endDate,
      })
      .from(approvalRequests)
      .leftJoin(
        leaveRequestsTable,
        eq(leaveRequestsTable.approvalId, approvalRequests.id),
      )
      .where(
        and(
          eq(approvalRequests.id, approvalRowId),
          eq(approvalRequests.organizationId, orgId),
        ),
      )
      .limit(1);
    if (!row) throw new Error("Permintaan tidak ditemukan.");

    const nextApproval =
      decision === "approve"
        ? approveApproval(row.state, user.id, note)
        : rejectApproval(row.state, user.id, note);

    await saveApprovalRequest(orgId, nextApproval);

    // Approved cuti/izin: debit saldo tahun mulai.
    if (nextApproval.status === "approved" && row.employeeId && row.startDate) {
      const year = Number(row.startDate.slice(0, 4));
      const days = computeDuration(row.startDate, row.endDate ?? row.startDate);
      await getOrCreateBalance(user.id, orgId, row.employeeId, year);
      await debitBalance(
        user.id,
        orgId,
        row.employeeId,
        year,
        row.leaveType === "izin" ? "izinRemaining" : "cutiRemaining",
        days,
      );
    }

    await recordAudit({
      orgId,
      userId: user.id,
      action: `leave.${decision}`,
      entity: "leave_request",
      entityId: row.requestId,
      metadata: { note },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Terjadi kesalahan.";
    redirect(`/cuti?error=${encodeURIComponent(message)}`);
  }
  redirect(
    `/cuti?ok=${encodeURIComponent(decision === "approve" ? "Permintaan disetujui." : "Permintaan ditolak.")}`,
  );
}
