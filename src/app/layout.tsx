import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import { CommandPaletteLoader } from "@/components/command-palette-loader";
import { ModeGate } from "@/components/mode-gate";
import { Toaster } from "@/components/toast";
import { Nav } from "@/components/nav";
import { DriveSync } from "@/components/drive-sync";
import { Notifier } from "@/components/notifier";
import { THEME_SCRIPT } from "@/lib/theme-script";
import "./globals.css";

// One family throughout: Geist's weights carry the hierarchy and its tabular figures the countdowns.
const geist = Geist({ variable: "--font-geist", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Amity Exams",
  description: "Personal exam planner and AI study helper",
  applicationName: "Amity Exams",
  appleWebApp: { capable: true, title: "Amity Exams", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  // Matches the top bar (--surface) in each theme; a theme pinned in Settings updates these at runtime.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#1e2925" },
  ],
  colorScheme: "light dark",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    // The inline script sets data-theme before hydration, hence the warning suppression on <html> only.
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className={`${geist.variable} font-sans antialiased`}>
        {/* First launch asks mid-sem or major before showing the app. */}
        <ModeGate>
          <Nav />
          <Notifier />
          <DriveSync />
          <CommandPaletteLoader />
          <Toaster />
          {/* The same column as the top bar's, so the page's left edge lines up with the logo. */}
          <main className="mx-auto max-w-5xl px-4 pb-28 pt-6 sm:px-6 md:px-8 md:pb-20 md:pt-10">{children}</main>
        </ModeGate>
      </body>
    </html>
  );
}
