"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, BookOpen, CalendarDays, GraduationCap, House, RotateCcw, Search, Settings } from "lucide-react";
import { openCommandPalette } from "./command-palette";
import { ModePill } from "./mode-pill";
import { cn } from "./ui";

const primary = [
  { href: "/", label: "Today", icon: House },
  { href: "/planner", label: "Planner", icon: CalendarDays },
  { href: "/subjects", label: "Subjects", icon: BookOpen },
  { href: "/exams", label: "Exams", icon: GraduationCap },
  { href: "/revise", label: "Revise", icon: RotateCcw },
];
const secondary = [
  { href: "/progress", label: "Progress", icon: BarChart3 },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Nav() {
  const path = usePathname();
  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));
  const item = ({ href, label, icon: Icon }: (typeof primary)[number]) => (
    <li key={href}>
      <Link
        href={href}
        aria-current={active(href) ? "page" : undefined}
        className={cn(
          "flex items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] transition-colors",
          active(href) ? "bg-accent-soft font-semibold text-accent" : "text-text/80 hover:bg-surface-2 hover:text-text",
        )}
      >
        <Icon size={19} strokeWidth={active(href) ? 2.25 : 1.75} />
        {label}
      </Link>
    </li>
  );
  return (
    <>
      {/* Desktop: white sidebar */}
      <nav className="fixed inset-y-0 left-0 z-20 hidden w-64 flex-col border-r border-border bg-surface px-4 py-6 md:flex" aria-label="Main">
        <Link href="/" className="flex items-center gap-3 px-1">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-accent-ink shadow-sm">
            <GraduationCap size={21} />
          </span>
          <span className="text-lg font-bold tracking-tight">Amity Exams</span>
        </Link>
        <ModePill className="ml-1 mt-3 self-start" />
        <button
          type="button"
          onClick={openCommandPalette}
          className="mb-5 mt-5 flex h-10 items-center gap-2.5 rounded-xl border border-border bg-bg px-3 text-sm text-muted transition-colors hover:border-accent/40 hover:text-text"
        >
          <Search size={16} aria-hidden />
          <span className="flex-1 text-left">Search</span>
          <kbd className="rounded-md border border-border bg-surface px-1.5 text-[11px]">Ctrl K</kbd>
        </button>
        <ul className="space-y-1">{primary.map(item)}</ul>
        <ul className="mt-auto space-y-1 border-t border-border pt-4">{secondary.map(item)}</ul>
      </nav>

      {/* Mobile: five-item bottom bar; Progress and Settings live in the Today header */}
      <nav
        className="fixed inset-x-0 bottom-0 z-20 flex border-t border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
        aria-label="Main"
      >
        {primary.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            aria-current={active(href) ? "page" : undefined}
            className={cn(
              "relative flex flex-1 flex-col items-center gap-1 pb-2 pt-2.5 text-[11px]",
              active(href) ? "font-semibold text-accent" : "text-muted",
            )}
          >
            {active(href) && <span className="absolute top-0 h-0.5 w-8 rounded-full bg-accent" />}
            <Icon size={20} strokeWidth={active(href) ? 2.25 : 1.75} />
            {label}
          </Link>
        ))}
      </nav>
    </>
  );
}
