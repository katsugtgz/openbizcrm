import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";

type Tools = typeof import("@/lib/ai/tools");
type Schema = typeof import("@/db/schema");

const itDb = process.env.RUN_DB_TESTS === "1" ? it : it.skip;

describe("ai tools integration (this-month summary)", () => {
  const suffix = Date.now().toString(36);
  let db!: Awaited<ReturnType<() => Promise<typeof import("@/db")>>>["db"];
  let tools!: Tools;
  let schema!: Schema;

  beforeAll(async () => {
    if (process.env.RUN_DB_TESTS !== "1") return;
    ({ db } = await import("@/db"));
    tools = await import("@/lib/ai/tools");
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
      workosUserId: `it-aim-${suffix}-${createdUserIds.length}`,
      email: `it-aim-${suffix}-${createdUserIds.length}@test.id`,
    });
    createdUserIds.push(owner.id);
    const org = await (
      await import("@/lib/repos/org-repo")
    ).createOrg(
      {
        name: `AIM Org ${suffix}`,
        slug: `it-aim-${suffix}-${createdOrgIds.length}`,
      },
      owner.id,
    );
    createdOrgIds.push(org.id);
    return { userId: owner.id, orgId: org.id };
  }

  itDb("summary menghitung hanya org sendiri, bulan berjalan", async () => {
    const o = await makeOrg();
    const other = await makeOrg();
    const since = tools.currentMonthStart();
    const sinceDate = new Date(`${since}T00:00:00.000Z`);

    // Deal org sendiri (pipeline butuh company per constraint unik org+company+name)
    const company = await db
      .insert(schema.crmCompanies)
      .values({ orgId: o.orgId, name: "C" })
      .returning();
    const pipeline = await db
      .insert(schema.crmPipelines)
      .values({ orgId: o.orgId, companyId: company[0].id, name: "P" })
      .returning();
    const stage = await db
      .insert(schema.crmStages)
      .values({
        orgId: o.orgId,
        pipelineId: pipeline[0].id,
        name: "S",
        position: 1,
      })
      .returning();
    await db.insert(schema.crmDeals).values([
      {
        orgId: o.orgId,
        pipelineId: pipeline[0].id,
        stageId: stage[0].id,
        companyId: company[0].id,
        title: "D1",
      },
    ]);
    await db.insert(schema.crmContacts).values({
      orgId: other.orgId,
      companyId: (
        await db
          .insert(schema.crmCompanies)
          .values({ orgId: other.orgId, name: "C2" })
          .returning()
      )[0].id,
      name: "Kontak org lain",
    });

    const summary = await tools.computeThisMonthSummary(o.orgId, since);
    expect(summary.deals).toBe(1);
    expect(summary.contacts).toBe(0); // kontak org lain tak terhitung
    expect(summary.period).toBe(since);
    expect(since.endsWith("-01")).toBe(true);
    expect(sinceDate.getUTCDay()).toBeGreaterThanOrEqual(0);

    // formatMonthSummary teks Indonesia
    const text = tools.formatMonthSummary(summary);
    expect(text).toContain("Deal baru: 1");
    expect(text).toContain("Kontak baru: 0");
  });
});
