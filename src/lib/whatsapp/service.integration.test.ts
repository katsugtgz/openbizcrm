import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";

// DB-touching modules load ONLY when RUN_DB_TESTS=1 (lazy-import pattern).
type WaSvc = typeof import("@/lib/whatsapp/service");
type Schema = typeof import("@/db/schema");

const itDb = process.env.RUN_DB_TESTS === "1" ? it : it.skip;

describe("whatsapp service integration", () => {
  const suffix = Date.now().toString(36);
  let db!: Awaited<ReturnType<() => Promise<typeof import("@/db")>>>["db"];
  let wa!: WaSvc;
  let schema!: Schema;

  beforeAll(async () => {
    if (process.env.RUN_DB_TESTS !== "1") return;
    ({ db } = await import("@/db"));
    wa = await import("@/lib/whatsapp/service");
    schema = await import("@/db/schema");
  });

  const createdUserIds: string[] = [];
  const createdOrgIds: string[] = [];

  afterAll(async () => {
    if (process.env.RUN_DB_TESTS !== "1") return;
    for (const id of createdOrgIds) {
      await db
        .delete(schema.organizations)
        .where(eq(schema.organizations.id, id));
    }
    for (const id of createdUserIds) {
      await db.delete(schema.users).where(eq(schema.users.id, id));
    }
  });

  async function makeOrg(): Promise<{ userId: string; orgId: string }> {
    const owner = await (
      await import("@/lib/repos/user-repo")
    ).createUser({
      workosUserId: `it-wa-${suffix}-${createdUserIds.length}`,
      email: `it-wa-${suffix}-${createdUserIds.length}@test.id`,
    });
    createdUserIds.push(owner.id);
    const org = await (
      await import("@/lib/repos/org-repo")
    ).createOrg(
      {
        name: `WA Org ${suffix}`,
        slug: `it-wa-${suffix}-${createdOrgIds.length}`,
      },
      owner.id,
    );
    createdOrgIds.push(org.id);
    return { userId: owner.id, orgId: org.id };
  }

  itDb(
    "transisi sesi sah; lompatan invalid ditolak; enqueue butuh connected; FIFO; resolve idempoten; org isolation",
    async () => {
      const o = await makeOrg();

      // disconnected -> qr (sah)
      const s1 = await wa.transitionWhatsappSession(o.userId, o.orgId, "qr", {
        qrCode: "QR123",
      });
      expect(s1.status).toBe("qr");
      expect(s1.qrCode).toBe("QR123");

      // lompatan qr -> connected invalid
      await expect(
        wa.transitionWhatsappSession(o.userId, o.orgId, "connected"),
      ).rejects.toThrow();

      // qr -> connecting -> connected
      await wa.transitionWhatsappSession(o.userId, o.orgId, "connecting");
      const s3 = await wa.transitionWhatsappSession(
        o.userId,
        o.orgId,
        "connected",
        { phone: "+628123" },
      );
      expect(s3.status).toBe("connected");
      expect(s3.phone).toBe("+628123");

      // enqueue saat connected ok
      const m1 = await wa.enqueueWhatsappMessage(o.userId, o.orgId, {
        phone: "+628111",
        message: "halo 1",
      });
      const m2 = await wa.enqueueWhatsappMessage(o.userId, o.orgId, {
        phone: "+628222",
        message: "halo 2",
      });
      expect(m1.status).toBe("queued");

      // FIFO
      const queued = await wa.listQueuedOutbox(o.orgId);
      expect(queued.map((q) => q.id)).toEqual([m1.id, m2.id]);

      // resolve sent; idempoten kedua kali
      const r1 = await wa.resolveOutbox(o.userId, o.orgId, {
        id: m1.id,
        ok: true,
      });
      expect(r1?.status).toBe("sent");
      const rAgain = await wa.resolveOutbox(o.userId, o.orgId, {
        id: m1.id,
        ok: false,
        error: "late",
      });
      expect(rAgain?.status).toBe("sent"); // terminal, tidak berubah

      // org isolation: org lain tidak melihat outbox org pertama
      const other = await makeOrg();
      await wa.transitionWhatsappSession(other.userId, other.orgId, "qr");
      await wa.transitionWhatsappSession(
        other.userId,
        other.orgId,
        "connecting",
      );
      await wa.transitionWhatsappSession(
        other.userId,
        other.orgId,
        "connected",
      );
      await wa.enqueueWhatsappMessage(other.userId, other.orgId, {
        phone: "+628333",
        message: "org lain",
      });
      const otherQueued = await wa.listQueuedOutbox(other.orgId);
      expect(otherQueued).toHaveLength(1);
      expect(otherQueued[0].message).toBe("org lain");

      // cross-org resolve ditolak (row tidak ditemukan)
      const cross = await wa.resolveOutbox(other.userId, other.orgId, {
        id: m2.id,
        ok: true,
      });
      expect(cross).toBeNull();
      const m2Still = await wa.resolveOutbox(o.userId, o.orgId, {
        id: m2.id,
        ok: true,
      });
      expect(m2Still?.status).toBe("sent");
    },
  );

  itDb("enqueue saat belum connected melempar", async () => {
    const o = await makeOrg();
    await expect(
      wa.enqueueWhatsappMessage(o.userId, o.orgId, {
        phone: "+628999",
        message: "x",
      }),
    ).rejects.toThrow("belum tersambung");
  });
});
