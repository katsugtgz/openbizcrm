"use client";

import * as React from "react";
import Link from "next/link";
import { useTransition } from "react";
import { signOutAction } from "@/app/actions/sign-out";
import {
  BanknoteIcon,
  Building2,
  CalendarDays,
  CloudIcon,
  LayoutDashboard,
  LogOut,
  MessageSquare,
  Settings,
  Users,
  ClipboardList,
  Fingerprint,
} from "lucide-react";
import { cn } from "cn";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

export interface ShellUser {
  name: string;
  email: string;
  organizationId: string | null;
}

const NAV_ITEMS = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "Karyawan", href: "/karyawan", icon: Users },
  { label: "Presensi", href: "/presensi", icon: Fingerprint },
  { label: "Cuti", href: "/cuti", icon: CalendarDays },
  { label: "Penggajian", href: "/penggajian", icon: BanknoteIcon },
  { label: "CRM", href: "#", icon: Building2 },
  { label: "Proyek", href: "#", icon: ClipboardList },
  { label: "Akuntansi", href: "#", icon: BanknoteIcon },
  { label: "Chat", href: "#", icon: MessageSquare },
  { label: "Cloud", href: "#", icon: CloudIcon },
  { label: "Pengaturan", href: "#", icon: Settings },
] as const;

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav aria-label="Menu utama" className="flex flex-col gap-1">
      {NAV_ITEMS.map(({ label, href, icon: Icon }) => (
        <Link
          key={label}
          href={href}
          onClick={onNavigate}
          className={cn(
            "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors",
            "hover:bg-accent hover:text-accent-foreground",
            "focus-visible:bg-accent focus-visible:text-accent-foreground focus-visible:outline-none",
            href === "/dashboard" && "bg-accent text-accent-foreground",
          )}
          aria-current={href === "/dashboard" ? "page" : undefined}
        >
          <Icon className="size-4 shrink-0" aria-hidden="true" />
          {label}
        </Link>
      ))}
    </nav>
  );
}

function Brand() {
  return (
    <Link href="/dashboard" className="flex items-center gap-2">
      <span className="flex size-8 items-center justify-center rounded-md bg-primary text-sm font-bold text-primary-foreground">
        OB
      </span>
      <span className="text-sm font-semibold tracking-tight">OpenBizCRM</span>
    </Link>
  );
}

function UserMenu({ user }: { user: ShellUser }) {
  const [pending, startTransition] = useTransition();
  const initials = user.name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="size-8 rounded-full p-0"
          aria-label={`Menu pengguna: ${user.name}`}
        >
          <Avatar className="size-8">
            <AvatarFallback className="text-xs font-semibold">
              {initials || "P"}
            </AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="flex flex-col gap-0.5">
          <span className="truncate text-sm font-medium">{user.name}</span>
          <span className="truncate text-xs font-normal text-muted-foreground">
            {user.email}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <span className="flex w-full items-center justify-between">
            <span>Peran</span>
            <Badge variant="secondary">Anggota</Badge>
          </span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={pending}
          onSelect={(event) => {
            event.preventDefault();
            startTransition(async () => {
              await signOutAction();
            });
          }}
        >
          <LogOut className="size-4" aria-hidden="true" />
          {pending ? "Memproses…" : "Keluar"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function OrgSwitcher({ user }: { user: ShellUser }) {
  // ponytail: single-org static display — real switcher when multi-org lands.
  return (
    <div
      className="flex min-w-0 items-center gap-2 rounded-md border px-3 py-1.5"
      title={user.organizationId ?? "Tanpa organisasi"}
    >
      <Building2
        className="size-4 shrink-0 text-muted-foreground"
        aria-hidden="true"
      />
      <span className="truncate text-sm font-medium">
        {user.organizationId
          ? `Org ${user.organizationId.slice(0, 8)}…`
          : "Organisasi"}
      </span>
    </div>
  );
}

export function AppShell({
  user,
  children,
}: {
  user: ShellUser;
  children: React.ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = React.useState(false);

  return (
    <div className="flex min-h-dvh">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col gap-6 border-r bg-card p-4 lg:flex">
        <Brand />
        <NavLinks />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-40 flex h-14 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur supports-backdrop-filter:bg-background/75">
          {/* Mobile nav */}
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="lg:hidden"
                aria-label="Buka menu navigasi"
              >
                <svg
                  className="size-5"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  aria-hidden="true"
                >
                  <path d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-64">
              <SheetHeader>
                <SheetTitle asChild>
                  <div>
                    <Brand />
                  </div>
                </SheetTitle>
              </SheetHeader>
              <NavLinks onNavigate={() => setMobileOpen(false)} />
            </SheetContent>
          </Sheet>

          <OrgSwitcher user={user} />
          <div className="ml-auto">
            <UserMenu user={user} />
          </div>
        </header>

        <main className="flex-1 p-4 md:p-6">
          <div className="mx-auto w-full max-w-6xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
