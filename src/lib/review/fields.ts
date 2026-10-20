import type { ReviewFormField } from "@/db/schema";

const FIELD_TYPES = new Set([
  "text",
  "textarea",
  "number",
  "select",
  "checkbox",
]);

/**
 * Definisi field form 360 masuk sebagai JSON string dari form (dinamis).
 * Seluruh definisi ditolak bila SATU item pun gagal shape check (cubic
 * penilaian/actions.ts:50) — filter diam bisa menyimpan form tanpa
 * pertanyaan atau label undefined.
 */
export function parseFieldsJson(raw: string): ReviewFormField[] | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    for (const f of parsed) {
      if (typeof f !== "object" || f === null) return null;
      const r = f as ReviewFormField;
      if (typeof r.key !== "string" || !r.key.trim()) return null;
      if (typeof r.label !== "string" || !r.label.trim()) return null;
      if (!FIELD_TYPES.has(r.type)) return null;
      if (r.type === "select" && !Array.isArray(r.options)) return null;
    }
    return parsed as ReviewFormField[];
  } catch {
    return null;
  }
}
