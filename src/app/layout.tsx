import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans } from "next/font/google";
import { CommandPaletteLoader } from "@/components/command-palette-loader";
import { ModeGate } from "@/components/mode-gate";
import { Toaster } from "@/components/toast";
import { Nav } from "@/components/nav";
import { DriveSync } from "@/components/drive-sync";
import { Notifier } from "@/components/notifier";
import "./globals.css";

// One family throughout. Its width axis gives the condensed countdown figures and the narrower titles.
const plex = IBM_Plex_Sans({ variable: "--font-plex", subsets: ["latin"], axes: ["wdth"] });

export const metadata: Metadata = {
  title: "Amity Exams",
  description: "Personal exam planner and AI study helper",
  applicationName: "Amity Exams",
  appleWebApp: { capable: true, title: "Amity Exams", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: "#ffffff",
  colorScheme: "light",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${plex.variable} font-sans antialiased`}>
        {/* First launch asks mid-sem or major before showing the app. */}
        <ModeGate>
          <Nav />
          <Notifier />
          <DriveSync />
          <CommandPaletteLoader />
          <Toaster />
          <div className="md:pl-64">
            <main className="mx-auto max-w-5xl px-4 pb-28 pt-6 md:px-10 md:pb-16 md:pt-10">{children}</main>
          </div>
        </ModeGate>
      </body>
    </html>
  );
}
