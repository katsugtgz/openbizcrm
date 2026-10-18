import { Suspense } from "react";
import Link from "next/link";
import { getSignInUrl } from "@workos-inc/authkit-nextjs";
import { session } from "@/lib/auth";
import { redirect } from "next/navigation";
import { fakeSignInAction } from "@/app/actions/fake-sign-in";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/** Mirrors the middleware's configuration check. */
function isWorkosConfigured(): boolean {
  return (
    process.env.AUTH_FAKE !== "1" &&
    !!process.env.WORKOS_API_KEY &&
    !!process.env.WORKOS_CLIENT_ID
  );
}

/** Dev fixture list — same identities as src/db/seed.ts. */
const SEED_USERS = [
  { id: "seed-owner-1", email: "owner@contoh.co.id", name: "Budi Owner", role: "Owner" },
  { id: "seed-admin-1", email: "admin@contoh.co.id", name: "Sari Admin", role: "Admin" },
  { id: "seed-member-1", email: "member@contoh.co.id", name: "Andi Member", role: "Member" },
] as const;

/** Runtime-only: WorkOS authorization URL is uncached, per-request data. */
async function WorkosSignIn() {
  const signInUrl = await getSignInUrl();
  return (
    <Button asChild size="lg" className="w-full">
      <a href={signInUrl}>Masuk dengan WorkOS</a>
    </Button>
  );
}

/** Runtime-only session gate; inside the Suspense hole with the sign-in UI. */
async function SignInBody() {
  if (await session.getSession()) redirect("/dashboard");
  const fakeMode = process.env.AUTH_FAKE === "1";

  return (
    <div className="flex flex-col gap-4">
      {!fakeMode && isWorkosConfigured() ? (
        <Suspense fallback={<Button size="lg" className="w-full" disabled>Memuat…</Button>}>
          <WorkosSignIn />
        </Suspense>
      ) : !fakeMode ? (
        <p className="text-center text-sm text-muted-foreground">
          Autentikasi WorkOS belum dikonfigurasi. Isi WORKOS_API_KEY dan
          WORKOS_CLIENT_ID di .env, atau jalankan mode pengembangan dengan
          AUTH_FAKE=1.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="text-center text-xs text-muted-foreground">
            Mode pengembangan (AUTH_FAKE=1) — pilih pengguna uji:
          </p>
          {SEED_USERS.map((user) => (
            <form key={user.id} action={fakeSignInAction}>
              <input type="hidden" name="id" value={user.id} />
              <input type="hidden" name="email" value={user.email} />
              <input type="hidden" name="name" value={user.name} />
              <Button
                type="submit"
                variant="outline"
                className="w-full justify-between"
              >
                <span>{user.name}</span>
                <span className="text-xs text-muted-foreground">
                  {user.role}
                </span>
              </Button>
            </form>
          ))}
        </div>
      )}
      <Button asChild variant="ghost" size="sm">
        <Link href="/">Kembali ke halaman utama</Link>
      </Button>
    </div>
  );
}

export default function LoginPage() {
  return (
    <div className="flex min-h-dvh flex-col">
      <main className="flex flex-1 items-center justify-center px-4 py-16">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="mb-2 flex justify-center">
              <span className="flex size-10 items-center justify-center rounded-md bg-primary text-base font-bold text-primary-foreground">
                OB
              </span>
            </div>
            <CardTitle className="text-xl font-semibold tracking-tight">
              Masuk ke OpenBizCRM
            </CardTitle>
            <CardDescription>
              Satu platform untuk HRM, CRM, Akuntansi, dan kolaborasi tim.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <Suspense fallback={<Button size="lg" className="w-full" disabled>Memuat…</Button>}>
              <SignInBody />
            </Suspense>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
