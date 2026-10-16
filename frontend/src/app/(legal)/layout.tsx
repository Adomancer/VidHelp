import Link from "next/link";
import ThemeToggle from "@/components/ThemeToggle";

/** Public pages anyone can open without signing in: Terms of Service and Privacy Policy. */
export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-background">
      <header className="border-b">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3 sm:px-6">
          <Link href="/login" className="flex items-center gap-2.5">
            <span className="flex size-8 items-center justify-center rounded-lg bg-[#5750f1] text-sm font-bold text-white">V</span>
            <span className="font-semibold tracking-tight">VidHelp</span>
          </Link>
          <ThemeToggle />
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">{children}</main>

      <footer className="border-t">
        <div className="mx-auto flex max-w-3xl flex-wrap gap-x-5 gap-y-2 px-4 py-6 text-sm text-muted-foreground sm:px-6">
          <span>© {new Date().getFullYear()} VidHelp</span>
          <Link href="/terms" className="hover:text-foreground">
            Ketentuan Layanan
          </Link>
          <Link href="/privacy" className="hover:text-foreground">
            Kebijakan Privasi
          </Link>
        </div>
      </footer>
    </div>
  );
}
