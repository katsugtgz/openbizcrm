import { OrgScopeError } from "./org-scope";

/**
 * Typed user-facing validation error: static message, safe to reflect in
 * `?error=` redirect URLs. Throw this (not plain Error) for input problems
 * the user can act on.
 */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

/**
 * Pesan aman untuk ?error= di URL redirect: HANYA ValidationError statis
 * yang direfleksikan (whitelist tipe, bukan batas panjang — cubic pr10
 * cuti:51/karyawan:72). Error driver PG (detail constraint + nilai),
 * OrgScopeError, dan semua error dinamis lain dipetakan ke fallback
 * generik agar tidak masuk history browser, log, atau header Referer.
 */
export function safeRedirectError(error: unknown, fallback: string): string {
  if (error instanceof OrgScopeError) return "Akses ditolak.";
  if (error instanceof ValidationError) return error.message;
  return fallback;
}
