/**
 * Dev-only fake sign-in identities (AUTH_FAKE=1, non-production). Server-side
 * allowlist: the form carries only a user id; every other identity field is
 * resolved here. Never trust arbitrary posted identity attributes.
 */
export const FAKE_USERS = {
  "seed-owner-1": {
    id: "seed-owner-1",
    email: "owner@contoh.co.id",
    firstName: "Budi",
    lastName: "Owner",
  },
  "seed-admin-1": {
    id: "seed-admin-1",
    email: "admin@contoh.co.id",
    firstName: "Sari",
    lastName: "Admin",
  },
  "seed-member-1": {
    id: "seed-member-1",
    email: "member@contoh.co.id",
    firstName: "Andi",
    lastName: "Member",
  },
} as const;

export type FakeUserId = keyof typeof FAKE_USERS;
