import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import { setFakeUser } from "@/lib/auth/fake";

/**
 * UI smoke checks against the public interface of the two new routes.
 * Server components are rendered directly (no router); the auth gate and
 * WorkOS branches are covered by typecheck + e2e, not here.
 */

describe("landing page CTAs", () => {
  it("links Masuk to /login and dashboard CTA to /login (signed-out reachable)", async () => {
    const { default: Home } = await import("@/app/page");
    render(<Home />);
    const links = screen.getAllByRole("link", { name: "Masuk" });
    for (const link of links) {
      expect(link).toHaveAttribute("href", "/login");
    }
    const dashboard = screen.getByRole("link", { name: "Coba Dashboard" });
    expect(dashboard).toHaveAttribute("href", "/login");
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
    // CRM & Proyek now real routes (was placeholder # before module build-out)
    expect(within(nav).getByText("CRM")).toHaveAttribute("href", "/crm");
    expect(within(nav).getByText("Proyek")).toHaveAttribute("href", "/proyek");

    // Org display renders (cubic ui-smoke.test.tsx:59 — asserted, not assumed)
    expect(screen.getByText("Organisasi")).toBeInTheDocument();

    // User menu trigger present with accessible name
    const menuTrigger = screen.getByRole("button", {
      name: /Menu pengguna: Budi Owner/,
    });
    expect(menuTrigger).toBeInTheDocument();

    // Open the menu and assert the Keluar item exists
    // (cubic ui-smoke.test.tsx:92). fireEvent (no user-event dep): the radix
    // DropdownMenuTrigger opens on pointerdown.
    fireEvent.pointerDown(menuTrigger, { button: 0, ctrlKey: false });
    expect(await screen.findByText("Keluar")).toBeInTheDocument();
    // Auth gate (server layout) covered by e2e — redirect needs a router.
  });
});
