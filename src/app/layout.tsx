import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
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
      <body className={`${geist.variable} font-sans antialiased`}>{children}</body>
    </html>
  );
}
