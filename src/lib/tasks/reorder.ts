/**
 * Pure reorder logic untuk kanban (TDD). Tidak menyentuh DB.
 */

export interface ReorderItem {
  id: string;
  position: number;
}

export interface ReorderResult {
  /** Item yang position-nya berubah, siap di-persist. */
  updates: { id: string; position: number }[];
}

/**
 * Pindahkan `id` ke index `toIndex` di dalam daftar terurut, lalu
 * renumber 0..n-1. Dipakai untuk move WITHIN kolom (daftar = kolom asal)
 * dan BETWEEN kolom (daftar = kolom tujuan, item sudah masuk daftar).
 * Item lain tetap relatif urutnya.
 */
export function moveAndRenumber(
  items: ReorderItem[],
  id: string,
  toIndex: number,
): ReorderResult {
  const moving = items.find((it) => it.id === id);
  if (!moving) {
    throw new Error("Item tidak ada dalam daftar reorder.");
  }
  if (!Number.isInteger(toIndex) || toIndex < 0 || toIndex >= items.length) {
    throw new Error("Posisi tujuan tidak valid.");
  }
  const rest = items.filter((it) => it.id !== id);
  const ordered = [...rest.slice(0, toIndex), moving, ...rest.slice(toIndex)];
  const updates: { id: string; position: number }[] = [];
  ordered.forEach((it, index) => {
    if (it.position !== index) {
      updates.push({ id: it.id, position: index });
    }
  });
  return { updates };
}
