"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { format } from "date-fns";
import { GraduationCap, Search, Settings as SettingsIcon } from "lucide-react";
import { fromDay } from "@/lib/dates";
import { useToday } from "@/lib/use-today";
import { openCommandPalette } from "./command-palette-loader";
import { ModePill } from "./mode-pill";
import { cn } from "./ui";

/**
 * The header above every page: today's date (on phones, the app's mark) on the left, and the exam-mode switch on
 * the right, the one place it lives. Phones also get search and Settings here, since their bottom bar
 * has no room for them. The hairline runs full width; the contents line up with the page column below.
 */
export function TopBar() {
  const t = useToday();
  const path = usePathname();
  const icon = "press grid h-10 w-10 place-items-center rounded-xl text-muted hover:bg-surface-2 hover:text-text";
  const here = (href: string) => (path?.startsWith(href) ? { "aria-current": "page" as const, className: cn(icon, "bg-nav-active text-nav-active-ink") } : { className: icon });
  return (
    <header className="no-print h-14 border-b border-border md:h-16">
      <div className="mx-auto flex h-full w-full max-w-7xl items-center justify-between gap-3 px-4 group-has-[[data-wide]]/main:max-w-[88rem] group-has-[[data-full]]/main:max-w-none sm:px-6 md:px-8">
        <Link href="/" aria-label="Amity Exams, Today" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent-solid text-accent-ink md:hidden">
          <GraduationCap size={17} aria-hidden />
        </Link>
        <p className="hidden text-sm font-medium tabular-nums text-muted md:block">{format(fromDay(t), "EEEE, d MMMM")}</p>
        <div className="flex min-w-0 items-center gap-1 md:gap-3">
          <ModePill className="shrink-0" />
          <div className="-mr-2 flex shrink-0 md:hidden">
            <button type="button" onClick={openCommandPalette} className={icon} aria-label="Search"><Search size={19} /></button>
            <Link href="/settings" aria-label="Settings" {...here("/settings")}><SettingsIcon size={19} /></Link>
          </div>
        </div>
      </div>
    </header>
  );
}
