import { describe, expect, it } from "vitest";
import { validateAnswers } from "./validate";
import type { ReviewFormField } from "@/db/schema";

const fields: ReviewFormField[] = [
  { key: "nama", label: "Nama", type: "text", required: true },
  { key: "komentar", label: "Komentar", type: "textarea", required: true },
  {
    key: "skor",
    label: "Skor",
    type: "number",
    required: true,
    min: 1,
    max: 5,
  },
  {
    key: "peran",
    label: "Peran",
    type: "select",
    required: true,
    options: ["dev", "qa"],
  },
  { key: "setuju", label: "Setuju", type: "checkbox" },
  { key: "opsi", label: "Opsional", type: "text" },
];

describe("validateAnswers", () => {
  it("lolos untuk jawaban lengkap dan valid", () => {
    const errors = validateAnswers(fields, {
      nama: "Andi",
      komentar: "Bagus",
      skor: 4,
      peran: "dev",
      setuju: true,
    });
    expect(errors).toEqual({});
  });

  it("wajib kosong -> error per field", () => {
    const errors = validateAnswers(fields, {});
    expect(errors.nama).toBeTruthy();
    expect(errors.komentar).toBeTruthy();
    expect(errors.skor).toBeTruthy();
    expect(errors.peran).toBeTruthy();
    // Tidak wajib: bebas.
    expect(errors.setuju).toBeUndefined();
    expect(errors.opsi).toBeUndefined();
  });

  it("teks kosong/whitespace dianggap tidak diisi", () => {
    const errors = validateAnswers(fields, { nama: "   ", komentar: "" });
    expect(errors.nama).toBeTruthy();
    expect(errors.komentar).toBeTruthy();
  });

  it("angka di luar rentang / desimal ditolak", () => {
    expect(validateAnswers(fields, { skor: 0 }).skor).toBeTruthy();
    expect(validateAnswers(fields, { skor: 6 }).skor).toBeTruthy();
    expect(validateAnswers(fields, { skor: 3.5 }).skor).toBeTruthy();
    expect(validateAnswers(fields, { skor: 5 }).skor).toBeUndefined();
  });

  it("angka non-angka ditolak", () => {
    expect(validateAnswers(fields, { skor: "empat" }).skor).toBeTruthy();
  });

  it("pilihan di luar opsi ditolak", () => {
    expect(validateAnswers(fields, { peran: "manager" }).peran).toBeTruthy();
    expect(validateAnswers(fields, { peran: "qa" }).peran).toBeUndefined();
  });

  it("field tanpa opsi (select rusak) ditolak", () => {
    const broken: ReviewFormField[] = [
      { key: "p", label: "P", type: "select", required: true },
    ];
    expect(validateAnswers(broken, { p: "apa pun" }).p).toBeTruthy();
  });

  it("unknown field di jawaban diabaikan", () => {
    const errors = validateAnswers(fields, {
      nama: "X",
      komentar: "y",
      skor: 3,
      peran: "dev",
      asing: "apa pun",
    });
    expect(Object.keys(errors)).toEqual([]);
  });

  it("boolean bukan angka: true tidak jadi skor 1", () => {
    expect(validateAnswers(fields, { skor: true }).skor).toBeTruthy();
    expect(validateAnswers(fields, { skor: false }).skor).toBeTruthy();
  });

  it("field `__proto__` tidak merusak map error", () => {
    const proto: ReviewFormField[] = [
      { key: "__proto__", label: "Proto", type: "text", required: true },
    ];
    const errors = validateAnswers(proto, {});
    expect(Object.hasOwn(errors, "__proto__")).toBe(true);
    expect(errors.__proto__).toBeTruthy();
  });
});
