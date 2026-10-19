import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { organizations, products, users } from "@/db/schema";

const itDb = process.env.RUN_DB_TESTS === "1" ? it : it.skip;

describe("pos integration", () => {
  const suffix = Date.now().toString(36);
  let db!: Awaited<ReturnType<() => Promise<typeof import("@/db")>>>["db"];
  let pos!: typeof import("@/lib/pos/service");
  let acct!: typeof import("@/lib/accounting/service");

  beforeAll(async () => {
    if (process.env.RUN_DB_TESTS !== "1") return;
    ({ db } = await import("@/db"));
    pos = await import("@/lib/pos/service");
    acct = await import("@/lib/accounting/service");
  });

  const createdUserIds: string[] = [];
  const createdOrgIds: string[] = [];

  afterAll(async () => {
    if (process.env.RUN_DB_TESTS !== "1") return;
    for (const id of createdOrgIds) {
      await db.delete(organizations).where(eq(organizations.id, id));
    }
    for (const id of createdUserIds) {
      await db.delete(users).where(eq(users.id, id));
    }
  });

  async function makeOrg(): Promise<{ userId: string; orgId: string }> {
    const owner = await (
      await import("@/lib/repos/user-repo")
    ).createUser({
      workosUserId: `it-pos-${suffix}-${createdUserIds.length}`,
      email: `it-pos-${suffix}-${createdUserIds.length}@test.id`,
    });
    createdUserIds.push(owner.id);
    const org = await (
      await import("@/lib/repos/org-repo")
    ).createOrg(
      {
        name: `POS Org ${suffix}`,
        slug: `it-pos-${suffix}-${createdOrgIds.length}`,
      },
      owner.id,
    );
    createdOrgIds.push(org.id);
    return { userId: owner.id, orgId: org.id };
  }

  async function seedPosAccounts(o: { userId: string; orgId: string }) {
    await acct.createAccount(o.userId, o.orgId, {
      code: "1-1000",
      name: "Kas",
      type: "asset",
    });
    await acct.createAccount(o.userId, o.orgId, {
      code: "1-1100",
      name: "Bank",
      type: "asset",
    });
    await acct.createAccount(o.userId, o.orgId, {
      code: "4-1000",
      name: "Pendapatan",
      type: "revenue",
    });
  }

  itDb(
    "checkout TX: stock check, journal, race sequential double-buy, isolation",
    async () => {
      const o = await makeOrg();
      await seedPosAccounts(o);
      const product = await pos.addProduct(o.userId, o.orgId, {
        name: `Kopi ${suffix}`,
        sku: `KPI-${suffix}`,
        price: 25_000,
        initialStock: 3,
      });

      // stok kurang => throw, tidak ada mutasi
      await expect(
        pos.checkout(o.userId, o.orgId, {
          items: [{ productId: product.id, qty: 5 }],
          paymentMethod: "cash",
          date: "2026-11-01",
        }),
      ).rejects.toThrow(/Stok tidak cukup/);
      const [unchanged] = await db
        .select()
        .from(products)
        .where(eq(products.id, product.id));
      expect(unchanged.stockQty).toBe(3);

      // checkout 2: stok 3 -> 1, jurnal 50_000 kas/revenue
      const r1 = await pos.checkout(o.userId, o.orgId, {
        items: [{ productId: product.id, qty: 2 }],
        paymentMethod: "cash",
        date: "2026-11-01",
        taxPct: 11,
      });
      expect(r1.sale.saleNumber).toBe("SLS-001");
      expect(r1.sale.subtotal).toBe(50_000);
      expect(r1.sale.taxAmount).toBe(5_500);
      expect(r1.sale.total).toBe(55_500);
      const [p1] = await db
        .select()
        .from(products)
        .where(eq(products.id, product.id));
      expect(p1.stockQty).toBe(1);

      // race: sequential double-buy over remaining stock 1
      // buy 1 sukses
      await pos.checkout(o.userId, o.orgId, {
        items: [{ productId: product.id, qty: 1 }],
        paymentMethod: "qris",
        date: "2026-11-02",
      });
      // buy lagi => stok habis
      await expect(
        pos.checkout(o.userId, o.orgId, {
          items: [{ productId: product.id, qty: 1 }],
          paymentMethod: "cash",
          date: "2026-11-03",
        }),
      ).rejects.toThrow(/Stok tidak cukup/);

      // produk org lain tidak terlihat
      const o2 = await makeOrg();
      await seedPosAccounts(o2);
      const productB = await pos.addProduct(o2.userId, o2.orgId, {
        name: `Teh ${suffix}`,
        sku: `TEH-${suffix}`,
        price: 5_000,
        initialStock: 10,
      });
      await expect(
        pos.checkout(o2.userId, o2.orgId, {
          items: [{ productId: product.id, qty: 1 }], // produk org A
          paymentMethod: "cash",
          date: "2026-11-01",
        }),
      ).rejects.toThrow(/tidak ditemukan/);

      // stok org B tak tersentuh; nomor struk org B mulai 1
      const saleB = await pos.checkout(o2.userId, o2.orgId, {
        items: [{ productId: productB.id, qty: 1 }],
        paymentMethod: "transfer",
        date: "2026-11-01",
      });
      expect(saleB.sale.saleNumber).toBe("SLS-001");
      const [pB] = await db
        .select()
        .from(products)
        .where(eq(products.id, productB.id));
      expect(pB.stockQty).toBe(9);

      // jurnal balanced: org A total debit = 55_500 + 25_000
      const tbA = await acct.trialBalanceService(o.orgId);
      expect(tbA.balanced).toBe(true);
      expect(tbA.totalDebit).toBe(80_500);
      const tbB = await acct.trialBalanceService(o2.orgId);
      expect(tbB.totalDebit).toBe(5_000);

      // recentSales
      const recent = await pos.recentSales(o.orgId);
      expect(recent).toHaveLength(2);
      expect(recent[0].items.length).toBeGreaterThan(0);
    },
  );

  itDb("restock menambah stok; qty <= 0 ditolak", async () => {
    const o = await makeOrg();
    await seedPosAccounts(o);
    const product = await pos.addProduct(o.userId, o.orgId, {
      name: `Gula ${suffix}`,
      sku: `GUL-${suffix}`,
      price: 15_000,
      initialStock: 2,
    });
    const after = await pos.restock(o.userId, o.orgId, product.id, 10);
    expect(after.stockQty).toBe(12);
    await expect(
      pos.restock(o.userId, o.orgId, product.id, 0),
    ).rejects.toThrow();
    await expect(
      pos.restock(o.userId, o.orgId, product.id, -3),
    ).rejects.toThrow();
  });
});
