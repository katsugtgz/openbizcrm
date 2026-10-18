import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";

export type User = typeof users.$inferSelect;

export async function getUser(id: string): Promise<User | null> {
  const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return user ?? null;
}

export async function getUserByWorkosId(
  workosUserId: string,
): Promise<User | null> {
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.workosUserId, workosUserId))
    .limit(1);
  return user ?? null;
}

export async function getUserByEmail(email: string): Promise<User | null> {
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  return user ?? null;
}

export async function createUser(input: {
  workosUserId?: string | null;
  email: string;
  name?: string | null;
  avatarUrl?: string | null;
  currentOrgId?: string | null;
}): Promise<User> {
  const [user] = await db.insert(users).values(input).returning();
  return user;
}

export async function updateUser(
  id: string,
  input: Partial<
    Pick<
      User,
      "workosUserId" | "email" | "name" | "avatarUrl" | "currentOrgId"
    >
  >,
): Promise<User> {
  const [user] = await db
    .update(users)
    .set(input)
    .where(eq(users.id, id))
    .returning();
  return user;
}
