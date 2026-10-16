import type { Metadata } from "next";
import Link from "next/link";
import { CalendarDays, Radio, Wallet } from "lucide-react";
import ThemeToggle from "@/components/ThemeToggle";

export const metadata: Metadata = {
  title: "VidHelp - Masuk",
  description: "Masuk ke VidHelp Agency Management",
};

const highlights = [
  { icon: CalendarDays, title: "Jadwal dan backup", text: "Slot mingguan, rebutan event, dan pengganti saat host berhalangan." },
  { icon: Radio, title: "Live dan laporan", text: "Check-in, laporan live, dan persetujuan jam di satu tempat." },
  { icon: Wallet, title: "Gaji yang jelas", text: "Perkiraan gaji berjalan, slip, dan kasbon untuk setiap host." },
];

/** Sign-in pages: a brand panel beside the form on laptops, just the form on phones. */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh bg-background lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] xl:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <aside className="relative hidden overflow-hidden bg-[#16133d] p-10 text-white lg:flex lg:flex-col xl:p-14">
        {/* Soft grid and glow, drawn in CSS */}
        <div
          aria-hidden="true"
          className="absolute inset-0 opacity-[0.07] [background-image:linear-gradient(to_right,white_1px,transparent_1px),linear-gradient(to_bottom,white_1px,transparent_1px)] [background-size:44px_44px] [mask-image:radial-gradient(ellipse_at_top_left,black_30%,transparent_75%)]"
        />
        <div aria-hidden="true" className="absolute -top-40 -left-32 size-[32rem] rounded-full bg-[#5750f1] opacity-40 blur-[120px]" />
        <div aria-hidden="true" className="absolute -right-24 -bottom-48 size-[28rem] rounded-full bg-[#5750f1] opacity-25 blur-[120px]" />

        <div className="relative flex items-center gap-2.5">
          <span className="flex size-9 items-center justify-center rounded-lg bg-white text-base font-bold text-[#5750f1]">V</span>
          <span className="text-lg font-semibold tracking-tight">VidHelp</span>
        </div>

        <div className="relative mt-auto max-w-md space-y-8">
          <div className="space-y-3">
            <h2 className="text-3xl leading-tight font-semibold tracking-tight xl:text-4xl">Kelola host live streaming dari satu tempat.</h2>
            <p className="text-base text-white/70">Untuk host, operator, admin, dan finance agensi.</p>
          </div>
          <ul className="space-y-5">
            {highlights.map((item) => (
              <li key={item.title} className="flex gap-3.5">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-white/10 ring-1 ring-white/15">
                  <item.icon className="size-4" aria-hidden="true" />
                </span>
                <div>
                  <p className="text-sm font-medium">{item.title}</p>
                  <p className="text-sm text-white/60">{item.text}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative mt-auto pt-10 text-xs text-white/50">© {new Date().getFullYear()} VidHelp</p>
      </aside>

      <main className="relative flex min-h-dvh flex-col">
        <div className="flex justify-end p-4">
          <ThemeToggle />
        </div>
        <div className="flex flex-1 items-center justify-center px-5 pb-12 sm:px-8">{children}</div>
        <nav className="flex justify-center gap-5 pb-6 text-xs text-muted-foreground">
          <Link href="/terms" className="hover:text-foreground">
            Ketentuan Layanan
          </Link>
          <Link href="/privacy" className="hover:text-foreground">
            Kebijakan Privasi
          </Link>
        </nav>
      </main>
    </div>
  );
}
