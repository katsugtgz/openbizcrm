import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";

type AiConv = typeof import("@/lib/ai/conversation");
type Schema = typeof import("@/db/schema");

const itDb = process.env.RUN_DB_TESTS === "1" ? it : it.skip;

describe("ai conversation persistence integration", () => {
  const suffix = Date.now().toString(36);
  let db!: Awaited<ReturnType<() => Promise<typeof import("@/db")>>>["db"];
  let ai!: AiConv;
  let schema!: Schema;

  beforeAll(async () => {
    if (process.env.RUN_DB_TESTS !== "1") return;
    ({ db } = await import("@/db"));
    ai = await import("@/lib/ai/conversation");
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
      workosUserId: `it-ai-${suffix}-${createdUserIds.length}`,
      email: `it-ai-${suffix}-${createdUserIds.length}@test.id`,
    });
    createdUserIds.push(owner.id);
    const org = await (
      await import("@/lib/repos/org-repo")
    ).createOrg(
      {
        name: `AI Org ${suffix}`,
        slug: `it-ai-${suffix}-${createdOrgIds.length}`,
      },
      owner.id,
    );
    createdOrgIds.push(org.id);
    return { userId: owner.id, orgId: org.id };
  }

  itDb(
    "create + append urut; listMessages org-guard; cross-org list kosong",
    async () => {
      const o = await makeOrg();
      const conv = await ai.createConversation(o.userId, o.orgId);
      await ai.appendMessage(o.orgId, conv.id, "user", "pertanyaan pertama");
      await ai.appendMessage(o.orgId, conv.id, "assistant", "jawaban pertama");

      const msgs = await ai.listMessages(o.orgId, conv.id);
      expect(msgs.map((m) => [m.role, m.content])).toEqual([
        ["user", "pertanyaan pertama"],
        ["assistant", "jawaban pertama"],
      ]);

      // org isolation: org lain tidak melihat conversation ini
      const other = await makeOrg();
      expect(await ai.listMessages(other.orgId, conv.id)).toEqual([]);

      // role enum: nilai lain ditolak DB
      const { sql } = await import("drizzle-orm");
      await expect(
        db.execute(
          sql`insert into ai_messages (conversation_id, role, content) values (${conv.id}, 'system', 'x')`,
        ),
      ).rejects.toThrow();
    },
  );
});
