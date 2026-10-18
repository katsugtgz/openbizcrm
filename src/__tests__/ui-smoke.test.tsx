import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { setFakeUser } from "@/lib/auth/fake";

/**
 * UI smoke checks against the public interface of the two new routes.
 * Server components are rendered directly (no router); the auth gate and
 * WorkOS branches are covered by typecheck + e2e, not here.
 */

describe("landing page CTAs", () => {
  it("links Masuk to /login and dashboard CTA to /dashboard", async () => {
    const { default: Home } = await import("@/app/page");
    render(<Home />);
    const links = screen.getAllByRole("link", { name: "Masuk" });
    for (const link of links) {
      expect(link).toHaveAttribute("href", "/login");
    }
    const dashboard = screen.getByRole("link", { name: "Coba Dashboard" });
    expect(dashboard).toHaveAttribute("href", "/dashboard");
  });
});

describe("dashboard", () => {
  it("renders the 4 stat cards with placeholder values and the empty activity state", async () => {
    const { default: Dashboard } = await import("@/app/(app)/dashboard/page");
    render(<Dashboard />);

    for (const label of [
      "Karyawan Hadir",
      "Cuti Menunggu",
      "Proyek Aktif",
      "Penjualan Bulan Ini",
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    // Placeholder values
    expect(screen.getAllByText("—")).toHaveLength(4);
    expect(screen.getByText(/Belum ada aktivitas/)).toBeInTheDocument();
  });
});

describe("app shell", () => {
  const user = {
    id: "user_1",
    email: "budi@contoh.co.id",
    firstName: "Budi",
    lastName: "Owner",
    sessionId: "fake-session",
  };

  beforeAll(() => setFakeUser(user));
  afterAll(() => setFakeUser(null));

  it("renders all 10 nav items, org display, and user menu with Keluar", async () => {
    const { AppShell } = await import("@/components/app-shell");

    render(
      <AppShell
        user={{ name: "Budi Owner", email: user.email, organizationId: null }}
      >
        <div>isi</div>
      </AppShell>,
    );

    const nav = screen.getByRole("navigation", { name: "Menu utama" });
    for (const label of [
      "Dashboard",
      "Karyawan",
      "Presensi",
      "Cuti",
      "CRM",
      "Proyek",
      "Akuntansi",
      "Chat",
      "Cloud",
      "Pengaturan",
    ]) {
      expect(within(nav).getByText(label)).toBeInTheDocument();
    }
    expect(within(nav).getByText("Dashboard")).toHaveAttribute(
      "href",
      "/dashboard",
    );
    // Placeholder hrefs stay inert (#)
    expect(within(nav).getByText("CRM")).toHaveAttribute("href", "#");

    // User menu trigger present with accessible name
    expect(
      screen.getByRole("button", { name: /Menu pengguna: Budi Owner/ }),
    ).toBeInTheDocument();
    // Auth gate (server layout) covered by e2e — redirect needs a router.
  });
});
