/**
 * Read Postgres error identity through drizzle's wrapper. Drizzle throws
 * DrizzleQueryError { query, params, cause } — the SQLSTATE code and
 * constraint name live on `cause` (the postgres-js error), NOT on the
 * outer message (cubic pr10 r2 fake:251/crm:230). Matching on the outer
 * `error.code`/`error.message` silently never fires.
 */
export function pgErrorParts(error: unknown): {
  code?: string;
  constraint?: string;
} {
  const outer = (error ?? {}) as {
    code?: unknown;
    constraint?: unknown;
    constraint_name?: unknown;
    cause?: unknown;
  };
  const inner = ((outer.cause ?? outer) ?? {}) as {
    code?: unknown;
    constraint?: unknown;
    constraint_name?: unknown;
  };
  const code =
    typeof inner.code === "string"
      ? inner.code
      : typeof outer.code === "string"
        ? outer.code
        : undefined;
  const raw =
    inner.constraint ??
    inner.constraint_name ??
    outer.constraint ??
    outer.constraint_name;
  return { code, constraint: typeof raw === "string" ? raw : undefined };
}
