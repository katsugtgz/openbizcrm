import { describe, expect, it } from "vitest";
import { moveAndRenumber } from "./reorder";

const mk = (id: string, position: number) => ({ id, position });

describe("moveAndRenumber", () => {
  it("moves within column and renumbers 0..n-1", () => {
    const items = [mk("a", 0), mk("b", 1), mk("c", 2)];
    const { updates } = moveAndRenumber(items, "a", 2);
    expect(updates).toEqual([
      { id: "b", position: 0 },
      { id: "c", position: 1 },
      { id: "a", position: 2 },
    ]);
  });

  it("keeps unaffected items relative order (reorder others intact)", () => {
    const items = [mk("a", 0), mk("b", 1), mk("c", 2), mk("d", 3)];
    const { updates } = moveAndRenumber(items, "d", 1);
    // a stays 0; final order: a, d, b, c
    expect(updates).toEqual([
      { id: "d", position: 1 },
      { id: "b", position: 2 },
      { id: "c", position: 3 },
    ]);
  });

  it("no-op when item already at target position", () => {
    const items = [mk("a", 0), mk("b", 1)];
    expect(moveAndRenumber(items, "a", 0).updates).toEqual([]);
  });

  it("throws for unknown id or invalid index", () => {
    const items = [mk("a", 0), mk("b", 1)];
    expect(() => moveAndRenumber(items, "z", 0)).toThrow(/daftar reorder/);
    expect(() => moveAndRenumber(items, "a", 5)).toThrow(/tidak valid/);
    expect(() => moveAndRenumber(items, "a", -1)).toThrow(/tidak valid/);
  });
});
