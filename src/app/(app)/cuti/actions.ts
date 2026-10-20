"use server";

import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { leaveRequests as leaveRequestsTable } from "@/db/schema";
import { session } from "@/lib/auth";
import { resolveSessionIds } from "@/lib/auth/ids";
import { hasRole, OrgScopeError, requireOrgRole } from "@/lib/org-scope";
import {
  saveApprovalRequest,
  getApprovalRequestByRowIdForUpdate,
  saveApprovalRequestTx,
} from "@/lib/approval/store";
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
  debitBalanceChecked,
  getEmployeeByUser,
} from "@/lib/leave/repo";
import { listMembers } from "@/lib/repos/member-repo";
import { recordAudit } from "@/lib/repos/audit-repo";

async function requireSession() {
  const user = await session.getSession();
  if (!user) redirect("/login");
  // WorkOS session IDs -> internal UUIDs before the org-scoped guards.
  const ids = await resolveSessionIds(user);
  if (!ids) throw new Error("Tidak ada organisasi aktif.");
  return ids;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Pesan aman untuk ?error= di URL redirect: hanya string validasi statis
 * yang direfleksikan. Error driver PG (code 22/23/42/53…: detail constraint
 * + nilai) dan OrgScopeError dipetakan ke fallback generik agar tidak masuk
 * history browser, log, atau header Referer.
 */
function safeRedirectError(error: unknown, fallback: string): string {
  if (error instanceof OrgScopeError) return "Akses ditolak.";
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && /^(22|23|42|53)/.test(code)) {
      return fallback;
    }
    if (error.message.length > 200) return fallback;
    return error.message;
  }
  return fallback;
}

/**
 * Ajukan cuti/izin. Auto-detect izin/cuti dari tanggal (mid-year rule)
 * kecuali user paksa via `type`.
 */
export async function submitLeaveAction(formData: FormData): Promise<void> {
  const { userId, orgId } = await requireSession();
  await requireOrgRole(userId, orgId, "member");

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

    const employee = await getEmployeeByUser(userId, orgId);
    if (!employee) throw new Error("Profil karyawan tidak ditemukan.");

    const days = computeDuration(startDate, endDate);
    if (days <= 0) throw new Error("Rentang tanggal tidak valid.");

    // Rantai approval: satu admin/owner org lain (bukan pemohon) — filter
    // per membership.role, bukan sekadar "anggota org manapun".
    const approver = (await listMembers(userId, orgId))
      .filter(
        (m) => hasRole(m.membership.role, "admin") && m.user.id !== userId,
      )
      .map((m) => m.user)[0];
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
      requesterId: userId,
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
    await createLeave(userId, orgId, {
      employeeId: employee.id,
      type,
      startDate,
      endDate,
      reason,
      approvalId,
    });

    await recordAudit({
      orgId,
      userId: userId,
      action: "leave.submit",
      entity: "leave_request",
      entityId: requestId,
      metadata: { type, startDate, endDate, days },
    });
  } catch (error) {
    const message = safeRedirectError(error, "Pengajuan gagal disimpan.");
    redirect(`/cuti?error=${encodeURIComponent(message)}`);
  }
  redirect(`/cuti?ok=${encodeURIComponent("Pengajuan cuti/izin terkirim.")}`);
}

/**
 * Setujui atau tolak permintaan (approver saat ini di rantai).
 *
 * Atomik dalam satu transaksi: baris approval dikunci (FOR UPDATE) supaya
 * dua keputusan konkuren terserialisasi — yang kalah melihat status
 * terminal dan engine menolaknya, bukan menimpa + debit ganda.
 */
export async function actLeaveAction(formData: FormData): Promise<void> {
  const { userId, orgId } = await requireSession();
  await requireOrgRole(userId, orgId, "member");

  const approvalRowId = String(formData.get("approvalId") ?? "");
  const decision = String(formData.get("decision") ?? "");
  const note = String(formData.get("note") ?? "").trim() || undefined;
  try {
    // Bentuk UUID dicek dulu: nilai liar jadi "tidak valid", bukan error
    // cast uuid PG 22P02.
    if (
      !UUID_RE.test(approvalRowId) ||
      (decision !== "approve" && decision !== "reject")
    ) {
      throw new Error("Keputusan tidak valid.");
    }

    await db.transaction(async (tx) => {
      const approval = await getApprovalRequestByRowIdForUpdate(
        tx,
        orgId,
        approvalRowId,
      );
      const [leave] = await tx
        .select({
          employeeId: leaveRequestsTable.employeeId,
          leaveType: leaveRequestsTable.type,
          startDate: leaveRequestsTable.startDate,
          endDate: leaveRequestsTable.endDate,
        })
        .from(leaveRequestsTable)
        .where(
          and(
            eq(leaveRequestsTable.approvalId, approvalRowId),
            eq(leaveRequestsTable.orgId, orgId),
          ),
        )
        .limit(1);

      const nextApproval =
        decision === "approve"
          ? approveApproval(approval.state, userId, note)
          : rejectApproval(approval.state, userId, note);

      await saveApprovalRequestTx(tx, orgId, nextApproval);

      // Approved cuti/izin: debit saldo tahun mulai. Bersyarat
      // (remaining >= days): overdraft melempar, bukan clamp diam.
      if (
        nextApproval.status === "approved" &&
        leave?.employeeId &&
        leave?.startDate
      ) {
        const year = Number(leave.startDate.slice(0, 4));
        const days = computeDuration(
          leave.startDate,
          leave.endDate ?? leave.startDate,
        );
        await getOrCreateBalance(userId, orgId, leave.employeeId, year, tx);
        await debitBalanceChecked(
          userId,
          orgId,
          leave.employeeId,
          year,
          leave.leaveType === "izin" ? "izinRemaining" : "cutiRemaining",
          days,
          tx,
        );
      }

      await recordAudit(
        {
          orgId,
          userId: userId,
          action: `leave.${decision}`,
          entity: "leave_request",
          entityId: approval.state.requestId,
          metadata: { note },
        },
        tx,
      );
    });
  } catch (error) {
    const message = safeRedirectError(error, "Keputusan gagal disimpan.");
    redirect(`/cuti?error=${encodeURIComponent(message)}`);
  }
  redirect(
    `/cuti?ok=${encodeURIComponent(decision === "approve" ? "Permintaan disetujui." : "Permintaan ditolak.")}`,
  );
}
