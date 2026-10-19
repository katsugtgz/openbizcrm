/**
 * Label quotation status — modul bersama tanpa "use client" (cubic P1
 * deal-actions:104): server component (page.tsx) tak boleh dot-access export
 * dari modul "use client".
 */
export const QUOT_LABEL: Record<string, string> = {
  draft: "Draft",
  sent: "Terkirim",
  accepted: "Diterima",
  rejected: "Ditolak",
};
