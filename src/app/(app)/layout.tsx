import { CommandPaletteLoader } from "@/components/command-palette-loader";
import { ModeGate } from "@/components/mode-gate";
import { ProfileGate } from "@/components/profile-gate";
import { Toaster } from "@/components/toast";
import { Nav } from "@/components/nav";
import { TopBar } from "@/components/top-bar";
import { DriveSync } from "@/components/drive-sync";
import { Notifier } from "@/components/notifier";

// The app itself: every page that reads the student's data. Pages outside this group (sign-in and the like) get
// neither the database nor the navigation. Nothing here reads cookies or the session, so every page stays the same
// for every visitor and can be cached.
export default function AppLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    // Opens this profile's browser database first; nothing below touches data until it has.
    <ProfileGate>
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
    </ProfileGate>
  );
}
