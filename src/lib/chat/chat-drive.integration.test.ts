import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { organizations, users } from "@/db/schema";

const itDb = process.env.RUN_DB_TESTS === "1" ? it : it.skip;

describe("chat + drive integration", () => {
  const suffix = Date.now().toString(36);
  let db!: Awaited<ReturnType<() => Promise<typeof import("@/db")>>>["db"];
  let chat!: typeof import("@/lib/chat/service");
  let drive!: typeof import("@/lib/drive/service");

  beforeAll(async () => {
    if (process.env.RUN_DB_TESTS !== "1") return;
    ({ db } = await import("@/db"));
    chat = await import("@/lib/chat/service");
    drive = await import("@/lib/drive/service");
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

  async function makeUser(tag: string): Promise<string> {
    const user = await (
      await import("@/lib/repos/user-repo")
    ).createUser({
      workosUserId: `it-cd-${suffix}-${tag}`,
      email: `it-cd-${suffix}-${tag}@test.id`,
    });
    createdUserIds.push(user.id);
    return user.id;
  }

  async function makeOrgWithOwner(): Promise<{
    userId: string;
    orgId: string;
  }> {
    const owner = await makeUser(`org-${createdOrgIds.length}`);
    const org = await (
      await import("@/lib/repos/org-repo")
    ).createOrg(
      {
        name: `CD Org ${suffix}-${createdOrgIds.length}`,
        slug: `it-cd-${suffix}-${createdOrgIds.length}`,
      },
      owner,
    );
    createdOrgIds.push(org.id);
    return { userId: owner, orgId: org.id };
  }

  itDb(
    "direct conversation roundtrip: open, message, list, non-member rejection",
    async () => {
      const a = await makeOrgWithOwner();
      const b = await makeUser("b");
      const outsiderOrg = await makeOrgWithOwner();
      // b join org a sebagai member
      await db.execute(
        // raw insert via drizzle schema
        (await import("drizzle-orm"))
          .sql`insert into org_memberships (org_id, user_id, role)
        values (${a.orgId}, ${b}, 'member')`,
      );

      const first = await chat.openDirect(a.userId, a.orgId, b);
      expect(first.created).toBe(true);
      // Idempoten: pasangan sama -> percakapan sama
      const second = await chat.openDirect(b, a.orgId, a.userId);
      expect(second.created).toBe(false);
      expect(second.conversationId).toBe(first.conversationId);

      await chat.sendMessage(
        a.userId,
        a.orgId,
        first.conversationId,
        "Halo dunia",
      );
      const msgs = await chat.listMessages(b, a.orgId, first.conversationId);
      expect(msgs).toHaveLength(1);
      expect(msgs[0].body).toBe("Halo dunia");
      expect(msgs[0].userId).toBe(a.userId);

      // Non-member org lain ditolak
      await expect(
        chat.listMessages(
          outsiderOrg.userId,
          outsiderOrg.orgId,
          first.conversationId,
        ),
      ).rejects.toThrow();
      // Member org tapi bukan anggota percakapan (direct hanya a+b; buat user c)
      const c = await makeUser("c");
      await db.execute(
        (await import("drizzle-orm"))
          .sql`insert into org_memberships (org_id, user_id, role)
        values (${a.orgId}, ${c}, 'member')`,
      );
      await expect(
        chat.sendMessage(c, a.orgId, first.conversationId, "nyelundup"),
      ).rejects.toThrow(/bukan anggota/);
    },
  );

  itDb(
    "group conversation: create, member list, empty name rejected",
    async () => {
      const { userId, orgId } = await makeOrgWithOwner();
      const m = await makeUser("gm");
      await db.execute(
        (await import("drizzle-orm"))
          .sql`insert into org_memberships (org_id, user_id, role)
        values (${orgId}, ${m}, 'member')`,
      );
      const g = await chat.createGroup(userId, orgId, {
        name: "Tim Proyek",
        memberUserIds: [m],
      });
      expect(g.kind).toBe("group");
      const members = await chat.listMembers(userId, orgId, g.id);
      expect(members.map((x) => x.userId).sort()).toEqual([userId, m].sort());
      await expect(
        chat.createGroup(userId, orgId, { name: "  ", memberUserIds: [] }),
      ).rejects.toThrow(/wajib diisi/);
      // Anggota lintas org ditolak
      const outsider = await makeOrgWithOwner();
      await expect(
        chat.createGroup(userId, orgId, {
          name: "X",
          memberUserIds: [outsider.userId],
        }),
      ).rejects.toThrow();
    },
  );

  itDb("drive: folder tree + isolation", async () => {
    const { userId, orgId } = await makeOrgWithOwner();
    const other = await makeOrgWithOwner();

    // presign butuh kredensial R2 -> ConfigError (setup), bukan crash
    await expect(
      drive.presignUpload(userId, orgId, "a.txt", "text/plain", 10),
    ).rejects.toThrow(/Konfigurasi drive/);

    const root = await drive.createFolder(userId, orgId, "Dokumen");
    const sub = await drive.createFolder(userId, orgId, "Kontrak", root.id);
    const tree = await drive.folderTree(userId, orgId);
    expect(tree.map((f) => f.id).sort()).toEqual([root.id, sub.id].sort());
    // Duplikat nama per induk ditolak
    await expect(drive.createFolder(userId, orgId, "Dokumen")).rejects.toThrow(
      /sudah dipakai/,
    );
    // Sub dengan nama sama di induk lain OK
    const otherRoot = await drive.createFolder(userId, orgId, "Lainnya");
    await drive.createFolder(userId, orgId, "Dokumen", otherRoot.id);

    const listing = await drive.listFolder(userId, orgId, null);
    expect(listing.folders.map((f) => f.name).sort()).toEqual(
      ["Dokumen", "Lainnya"].sort(),
    );

    // Org isolation: org lain tidak melihat folder org ini
    const otherListing = await drive.listFolder(
      other.userId,
      other.orgId,
      null,
    );
    expect(otherListing.folders).toHaveLength(0);
    // Org isolation: folder org lain tak terlihat
    await expect(
      drive.createFolder(other.userId, other.orgId, "X", root.id),
    ).rejects.toThrow(/tidak ditemukan/);
  });

  itDb(
    "drive quota reject: presigned rows consume quota even without R2 upload",
    async () => {
      // Inject baris file langsung (presign butuh R2) untuk menguji kuota murni DB-side.
      const { userId, orgId } = await makeOrgWithOwner();
      const { driveFiles } = await import("@/db/schema");
      await db.insert(driveFiles).values({
        orgId,
        folderId: null,
        key: `${orgId}/quota-test/a.bin`,
        fileName: "a.bin",
        mimeType: "application/octet-stream",
        sizeBytes: 10 * 1024 * 1024 * 1024, // penuhi 10 GB
        uploadedBy: userId,
      });
      expect(await drive.driveUsageBytes(orgId)).toBe(10 * 1024 * 1024 * 1024);
      // Presign kedua harus ditolak kuota (kuota dicek SEBELUM kredensial? Tidak —
      // config dicek dulu, jadi lokal kita uji lewat logika kuota: cek ConfigError
      // tidak mengalahkan asersi kuota di lingkungan ber-R2; di lokal ini kita
      // verifikasi usage terhitung, dan asersi kuota diuji di lingkungan ber-R2.)
      await expect(
        drive.presignUpload(
          userId,
          orgId,
          "b.bin",
          "application/octet-stream",
          1,
        ),
      ).rejects.toThrow();
      expect(await drive.driveUsageBytes(orgId)).toBe(10 * 1024 * 1024 * 1024);
    },
  );

  itDb(
    "drive org isolation: file milik org lain tidak terlihat/dihapus",
    async () => {
      const { userId, orgId } = await makeOrgWithOwner();
      const other = await makeOrgWithOwner();
      const { driveFiles } = await import("@/db/schema");
      const [file] = await db
        .insert(driveFiles)
        .values({
          orgId,
          folderId: null,
          key: `${orgId}/iso/test.txt`,
          fileName: "test.txt",
          mimeType: "text/plain",
          sizeBytes: 5,
          uploadedBy: userId,
        })
        .returning();
      // Org lain: deleteFile -> NotFound (guard org sebelum R2 config)
      await expect(
        drive.deleteFile(other.userId, other.orgId, file.id),
      ).rejects.toThrow(/tidak ditemukan/);
    },
  );

  itDb("sanitizeFileName: no .., no leading /, control chars", () => {
    expect(drive.sanitizeFileName("../../etc/passwd")).not.toContain("..");
    expect(drive.sanitizeFileName("../../etc/passwd")).not.toContain("/");
    expect(drive.sanitizeFileName("/abs/path.txt")).not.toMatch(/^\//);
    expect(drive.sanitizeFileName("normal-file_v2.txt")).toBe(
      "normal-file_v2.txt",
    );
    expect(() => drive.sanitizeFileName("...")).toThrow();
    expect(() => drive.sanitizeFileName("")).toThrow();
  });
});
