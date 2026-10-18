import { describe, it, expect } from "vitest";
import { formatIDR, parseIDRInput } from "./money";

describe("formatIDR", () => {
  it("0 => Rp0", () => {
    expect(formatIDR(0)).toBe("Rp0");
  });

  it("1000 => Rp1.000", () => {
    expect(formatIDR(1000)).toBe("Rp1.000");
  });

  it("1500000 => Rp1.500.000", () => {
    expect(formatIDR(1500000)).toBe("Rp1.500.000");
  });

  it("Number.MAX_SAFE_INTEGER => Rp9.007.199.254.740.991", () => {
    expect(formatIDR(Number.MAX_SAFE_INTEGER)).toBe("Rp9.007.199.254.740.991");
  });

  it("negatif => -Rp1.000", () => {
    expect(formatIDR(-1000)).toBe("-Rp1.000");
  });

  it("non-integer => throws", () => {
    expect(() => formatIDR(1.5)).toThrow(/angka bulat/i);
  });

  it("> MAX_SAFE_INTEGER => throws", () => {
    expect(() => formatIDR(Number.MAX_SAFE_INTEGER + 1)).toThrow(
      /terlalu besar/i,
    );
  });
});

describe("parseIDRInput", () => {
  it('"0" => 0', () => {
    expect(parseIDRInput("0")).toBe(0);
  });

  it('"1000" => 1000', () => {
    expect(parseIDRInput("1000")).toBe(1000);
  });

  it('"1500000" => 1500000', () => {
    expect(parseIDRInput("1500000")).toBe(1500000);
  });

  it("MAX_SAFE digit string => Number.MAX_SAFE_INTEGER", () => {
    expect(parseIDRInput("9007199254740991")).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('non-digit ("Rp1000") => throws', () => {
    expect(() => parseIDRInput("Rp1000")).toThrow(/angka/i);
  });

  it('pemisah ("1.000") => throws', () => {
    expect(() => parseIDRInput("1.000")).toThrow(/angka/i);
  });

  it('desimal ("1000.5") => throws', () => {
    expect(() => parseIDRInput("1000.5")).toThrow(/angka/i);
  });

  it('negatif ("-1000") => throws', () => {
    expect(() => parseIDRInput("-1000")).toThrow(/angka/i);
  });

  it('huruf ("abc") => throws', () => {
    expect(() => parseIDRInput("abc")).toThrow(/angka/i);
  });

  it("string kosong => throws", () => {
    expect(() => parseIDRInput("")).toThrow(/angka/i);
  });

  it("> MAX_SAFE_INTEGER => throws", () => {
    expect(() => parseIDRInput("99999999999999999999")).toThrow(
      /terlalu besar/i,
    );
  });
});
