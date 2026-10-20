import type { ReviewFormField } from "@/db/schema";

/**
 * Validasi jawaban form penilaian (murni): return errors map key -> pesan.
 * Map kosong = valid. Field tak dikenal di jawaban diabaikan (bukan error)
 * supaya form boleh bertambah field tanpa mematahkan jawaban lama.
 */
export function validateAnswers(
  fields: ReviewFormField[],
  answers: Record<string, unknown>,
): Record<string, string> {
  const errors: Record<string, string> = {};
  const byKey = new Set(fields.map((f) => f.key));

  for (const f of fields) {
    const raw = answers[f.key];
    const filled =
      raw !== undefined &&
      raw !== null &&
      String(raw).trim() !== "" &&
      raw !== false;

    if (f.required && !filled) {
      errors[f.key] = `${f.label} wajib diisi.`;
      continue;
    }
    if (!filled) continue; // opsional kosong: bebas

    switch (f.type) {
      case "text":
      case "textarea":
        if (typeof raw !== "string" && typeof raw !== "number") {
          errors[f.key] = `${f.label} harus berupa teks.`;
        }
        break;
      case "number": {
        const n = typeof raw === "number" ? raw : Number(raw);
        if (!Number.isSafeInteger(n)) {
          errors[f.key] = `${f.label} harus angka bulat.`;
        } else if (
          (f.min !== undefined && n < f.min) ||
          (f.max !== undefined && n > f.max)
        ) {
          errors[f.key] =
            `${f.label} harus antara ${f.min ?? "-∞"} dan ${f.max ?? "∞"}.`;
        }
        break;
      }
      case "select":
        if (!f.options || !f.options.includes(String(raw))) {
          errors[f.key] =
            `${f.label} harus salah satu dari: ${(f.options ?? []).join(", ")}.`;
        }
        break;
      case "checkbox":
        if (typeof raw !== "boolean") {
          errors[f.key] = `${f.label} harus berupa centang.`;
        }
        break;
    }
  }
  void byKey;
  return errors;
}
