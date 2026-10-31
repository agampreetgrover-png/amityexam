import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import { CommandPaletteLoader } from "@/components/command-palette-loader";
import { ModeGate } from "@/components/mode-gate";
import { Toaster } from "@/components/toast";
import { Nav } from "@/components/nav";
import { TopBar } from "@/components/top-bar";
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
  // Matches the sidebar (--side) in each theme; a theme pinned in Settings updates these at runtime.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0d0f17" },
  ],
  colorScheme: "light dark",
  // Without "cover", iOS reports every env(safe-area-inset-*) as 0 and the bottom bar sits under the home indicator.
  viewportFit: "cover",
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
          {/* Shown only when tabbed to, so the keyboard can jump past the sidebar. */}
          <a
            href="#main"
            className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-surface focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-accent focus:shadow-float"
          >
            Skip to content
          </a>
          <Nav />
          <Notifier />
          <DriveSync />
          <CommandPaletteLoader />
          {/* Left padding clears the fixed sidebar on desktop (its icon rail, then its wide form), plus a landscape
              notch; the page column is centred in what's left. A page that marks itself data-wide (Today, with its right-hand
              rail) gets a wider column; data-full (Chat) fills the whole area under the top bar, edge to edge. On mobile there's no sidebar, so the bottom bar gets room instead. */}
          <main
            id="main"
            tabIndex={-1}
            className="group/main focus:outline-none md:pl-[calc(4rem+env(safe-area-inset-left))] md:pr-[env(safe-area-inset-right)] lg:pl-[calc(16rem+env(safe-area-inset-left))]"
          >
            <TopBar />
            <div className="mx-auto max-w-7xl px-4 pb-28 pt-6 sm:px-6 md:px-8 md:pb-20 md:pt-8 has-[[data-wide]]:max-w-[88rem] has-[[data-full]]:max-w-none has-[[data-full]]:p-0">{children}</div>
          </main>
          {/* After the page, so a toast's Undo follows the content in tab order; it's fixed, so nothing moves. */}
          <Toaster />
        </ModeGate>
      </body>
    </html>
  );
}
