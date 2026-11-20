import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import CommandMenu from "./CommandMenu";
import HostBottomNav from "./HostBottomNav";
import HostShell from "./HostShell";
import NotificationBell from "./NotificationBell";
import PageHeader from "./PageHeader";
import { ThemeSwitcher } from "./ThemeToggle";

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    ViewTransition: (actual as Record<string, unknown>).ViewTransition ?? (({ children }: { children: ReactNode }) => <>{children}</>),
  };
});

const pushMock = vi.fn();

vi.mock("next/navigation", () => ({
  usePathname: () => "/host/live",
  useRouter: () => ({ push: pushMock, replace: vi.fn() }),
}));

vi.mock("./AuthProvider", () => ({
  useAuth: () => ({
    user: {
      id: "user-1",
      name: "Rina Host",
      email: "rina@vidhelp.com",
      avatar_url: null,
      roles: [{ name: "host" }],
    },
    token: "test-token",
    logout: vi.fn(),
  }),
}));

vi.mock("@/lib/useApiData", () => ({
  useApiData: (key: string) => {
    if (key === "notification-count") {
      return { data: { unread: 3 }, loading: false, error: null, reload: vi.fn() };
    }
    if (key === "notification-list") {
      return { data: { notifications: [] }, loading: false, error: null, reload: vi.fn() };
    }
    if (key === "live-today") {
      return {
        data: {
          sessions: [
            {
              slot_id: "slot-1",
              date: "2026-11-20",
              role: "own",
              start_at: "2026-11-20T09:00:00Z",
              end_at: "2099-11-20T12:00:00Z",
              brand: { id: "brand-1", name: "Brand Alpha" },
              attendance: { id: "att-1", check_in_at: "2026-11-20T09:00:00Z", check_out_at: null },
            },
          ],
        },
        loading: false,
        error: null,
        reload: vi.fn(),
      };
    }
    if (key === "my-events") {
      return { data: { events: [] }, loading: false, error: null, reload: vi.fn() };
    }
    return { data: undefined, loading: false, error: null, reload: vi.fn() };
  },
  useInvalidate: () => vi.fn(),
}));

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  vi.clearAllMocks();
  document.documentElement.classList.remove("dark");
  vi.stubGlobal("ResizeObserver", ResizeObserverMock);
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }));
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
});

describe("PageHeader", () => {
  it("renders a 24px title, description, actions, and 44px mobile back link", () => {
    render(
      <PageHeader
        title="Jadwal"
        description="Daftar slot mingguan"
        back={{ href: "/host/dashboard", label: "Kembali" }}
        actions={<button type="button">Tambah</button>}
      />
    );

    const heading = screen.getByRole("heading", { level: 1, name: "Jadwal" });
    expect(heading.className).toContain("text-2xl");
    expect(screen.getByText("Daftar slot mingguan")).toBeTruthy();

    const backLink = screen.getByRole("link", { name: "Kembali" });
    expect(backLink.className).toContain("min-h-11");
  });
});

describe("CommandMenu", () => {
  it("uses 44px mobile trigger button and opens search palette on click", async () => {
    render(<CommandMenu links={[{ group: "Utama", items: [{ href: "/admin/dashboard", label: "Dashboard", icon: "dashboard" }] }]} />);

    const trigger = screen.getByRole("button", { name: "Cari halaman atau host" });
    expect(trigger.className).toContain("size-11");
    expect(trigger.className).toContain("md:h-9");

    await userEvent.click(trigger);
    expect(await screen.findByPlaceholderText("Cari halaman…")).toBeTruthy();
  });
});

describe("ThemeSwitcher", () => {
  it("uses 44px mobile options and toggles dark class on documentElement", async () => {
    render(<ThemeSwitcher />);

    const darkBtn = screen.getByRole("radio", { name: "Gelap" });
    const lightBtn = screen.getByRole("radio", { name: "Terang" });
    expect(darkBtn.className).toContain("h-11");
    expect(lightBtn.className).toContain("h-11");

    await userEvent.click(darkBtn);
    expect(document.documentElement.classList.contains("dark")).toBe(true);

    await userEvent.click(lightBtn);
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });
});

describe("NotificationBell", () => {
  it("renders a 44px mobile icon button and AA-safe destructive-solid unread badge", () => {
    render(<NotificationBell />);

    const bell = screen.getByRole("button", { name: "Notifikasi, 3 belum dibaca" });
    expect(bell.className).toContain("size-11");

    const badge = screen.getByText("3");
    expect(badge.className).toContain("bg-destructive-solid");
    expect(badge.className).not.toMatch(/\bbg-destructive\b(?!-solid)/);
  });
});

describe("HostBottomNav", () => {
  it("renders 4 primary tabs + Lainnya and opens bottom sheet with secondary links and theme switcher", async () => {
    render(<HostBottomNav claimable={2} />);

    expect(screen.getByRole("link", { name: "Dashboard" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Live" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Jadwal" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Event, 2 blok bisa diambil" })).toBeTruthy();

    const moreBtn = screen.getByRole("button", { name: "Lainnya" });
    await userEvent.click(moreBtn);

    for (const label of ["Backup", "Gaji", "Skor", "Brand", "Profil"]) {
      expect(await screen.findByRole("link", { name: new RegExp(label) })).toBeTruthy();
    }
    expect(screen.getByRole("radiogroup", { name: "Tema" })).toBeTruthy();
  });
});

describe("HostShell", () => {
  it("renders live indicator in sidebar without animate-ping", () => {
    const { container } = render(
      <TooltipProvider>
        <HostShell>
          <div>Konten host</div>
        </HostShell>
      </TooltipProvider>
    );

    expect(screen.getByText("Sedang live")).toBeTruthy();
    expect(screen.getByText("Brand Alpha")).toBeTruthy();
    expect(container.innerHTML).not.toContain("animate-ping");
  });
});
