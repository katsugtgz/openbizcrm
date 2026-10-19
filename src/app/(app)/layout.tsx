import { Suspense } from "react";
import { redirect } from "next/navigation";
import { session } from "@/lib/auth";
import { AppShell } from "@/components/app-shell";
import { Toaster } from "@/components/ui/sonner";

/**
 * Runtime session gate + chrome. Session read lives in the Suspense hole
 * (cacheComponents forbids uncached data in the static shell); the shell
 * chrome itself is static.
 */
async function AuthenticatedShell({
  children,
}: {
  children: import("react").ReactNode;
}) {
  const user = await session.getSession();
  if (!user) redirect("/");

  const displayName =
    [user.firstName, user.lastName].filter(Boolean).join(" ") ||
    user.email.split("@")[0];

  return (
    <AppShell
      user={{
        name: displayName,
        email: user.email,
        organizationId: user.organizationId ?? null,
      }}
    >
      {children}
      <Toaster position="top-right" richColors />
    </AppShell>
  );
}

export default function AppLayout({
  children,
}: {
  children: import("react").ReactNode;
}) {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-dvh items-center justify-center text-sm text-muted-foreground">
          Memuat…
        </div>
      }
    >
      <AuthenticatedShell>{children}</AuthenticatedShell>
    </Suspense>
  );
}
