import Link from "next/link";
import { redirect } from "next/navigation";
import { session } from "@/lib/auth";
import { resolveSessionIds } from "@/lib/auth/ids";
import { requireOrgRole } from "@/lib/org-scope";
import { listConversations, listMessages } from "@/lib/chat/service";
import { listMembers } from "@/lib/repos/member-repo";
import { cn } from "@/lib/utils";
import { ChatRoom } from "./chat-room";
import { NewChatDialogs } from "./new-chat-dialogs";

export const metadata = { title: "Obrolan" };

function formatWIB(date: Date): string {
  const shifted = new Date(date.getTime() + 7 * 60 * 60_000);
  return shifted.toISOString().replace("T", " ").slice(0, 16) + " WIB";
}

export default async function ObrolanPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string }>;
}) {
  const user = await session.getSession();
  if (!user) redirect("/login");
  const ids = await resolveSessionIds(user);
  if (!ids) redirect("/dashboard");
  await requireOrgRole(ids.userId, ids.orgId, "member");
  const { c: requestedId } = await searchParams;

  const [conversations, members] = await Promise.all([
    listConversations(ids.userId, ids.orgId),
    listMembers(ids.userId, ids.orgId),
  ]);
  const nameById = new Map(
    members.map((m) => [m.user.id, m.user.name ?? m.user.email]),
  );
  const active =
    conversations.find((c) => c.id === requestedId) ?? conversations[0] ?? null;
  const messages = active
    ? await listMessages(ids.userId, ids.orgId, active.id)
    : [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Obrolan</h1>
          <p className="text-sm text-muted-foreground">
            Chat tim: percakapan langsung dan grup.
          </p>
        </div>
        <NewChatDialogs
          meId={ids.userId}
          members={members
            .filter((m) => m.user.id !== ids.userId)
            .map((m) => ({
              id: m.user.id,
              label: m.user.name ?? m.user.email,
            }))}
        />
      </div>
      <div className="grid gap-4 md:grid-cols-[260px_1fr]">
        <nav aria-label="Daftar percakapan" className="space-y-1">
          {conversations.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Belum ada percakapan.
            </p>
          )}
          {conversations.map((c) => (
            <Link
              key={c.id}
              href={`/obrolan?c=${c.id}`}
              className={cn(
                "block rounded-md border px-3 py-2 text-sm transition-colors hover:bg-accent",
                active?.id === c.id && "bg-accent text-accent-foreground",
              )}
            >
              <span className="block truncate font-medium">
                {c.kind === "group"
                  ? (c.name ?? "Grup")
                  : (c.name ?? "Percakapan langsung")}
              </span>
              <span className="text-xs text-muted-foreground">
                {c.memberCount} anggota
              </span>
            </Link>
          ))}
        </nav>
        {active ? (
          <ChatRoom
            key={active.id}
            conversationId={active.id}
            messages={messages.map((m) => ({
              id: m.id,
              name: nameById.get(m.userId) ?? "Anggota",
              body: m.body,
              at: formatWIB(m.createdAt),
              mine: m.userId === ids.userId,
            }))}
          />
        ) : (
          <p className="text-sm text-muted-foreground">
            Pilih atau buat percakapan untuk mulai mengobrol.
          </p>
        )}
      </div>
    </div>
  );
}
