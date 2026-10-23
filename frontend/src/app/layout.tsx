import type { Metadata } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import { headers } from "next/headers";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import { AuthSessionProvider } from "@/components/AuthProvider";
import QueryProvider from "@/components/QueryProvider";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { themeInitScript } from "@/lib/theme";
import "./globals.css";

const jakarta = Plus_Jakarta_Sans({
  variable: "--font-jakarta",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "VidHelp",
  description: "Platform manajemen agensi host live streaming",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Set by src/proxy.ts; the Content-Security-Policy only runs inline scripts carrying it
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <html lang="id" className={`${jakarta.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="flex min-h-full flex-col font-sans">
        <QueryProvider>
          <AuthSessionProvider>
            <NuqsAdapter>
              <TooltipProvider delayDuration={300}>{children}</TooltipProvider>
            </NuqsAdapter>
          </AuthSessionProvider>
        </QueryProvider>
        <Toaster position="bottom-right" closeButton />
      </body>
    </html>
  );
}
