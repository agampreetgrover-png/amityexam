"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLayoutEffect, useRef, useState, type MouseEvent } from "react";
import { BarChart3, BookOpen, CalendarDays, GraduationCap, House, RotateCcw, Search, Settings } from "lucide-react";
import { openCommandPalette } from "./command-palette-loader";
import { DevWarmup } from "./dev-warmup";
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
const ROUTES = [...primary, ...secondary].map((i) => i.href);

export function Nav() {
  const path = usePathname();
  // The clicked item lights up straight away, before the next page has loaded. It only counts while we're still
  // on the page it was clicked from, so it clears itself once the navigation lands (or a later one does).
  const [clicked, setClicked] = useState<{ href: string; from: string } | null>(null);
  const current = clicked?.from === path ? clicked.href : path;
  const active = (href: string) => (href === "/" ? current === "/" : current.startsWith(href));
  const onClick = (href: string) => (e: MouseEvent) => {
    if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || e.button !== 0) return; // opens a new tab or window
    setClicked({ href, from: path });
  };

  // One marker slides to whichever item is active, across both lists. The first placement snaps into place.
  // It's measured inside the links column, so the mode pill loading in above doesn't throw it off.
  const rail = useRef<HTMLDivElement>(null);
  const [pill, setPill] = useState<{ y: number; h: number; glide: boolean } | null>(null);
  useLayoutEffect(() => {
    const place = () => {
      const nav = rail.current;
      const on = nav?.querySelector<HTMLElement>('[aria-current="page"]');
      if (!nav || !on) return setPill(null);
      const top = on.getBoundingClientRect().top - nav.getBoundingClientRect().top;
      setPill((p) => ({ y: top, h: on.offsetHeight, glide: p != null }));
    };
    place();
    // Progress and Settings sit at the foot of the column, so a taller window or a late font swap moves them.
    const ro = new ResizeObserver(place);
    if (rail.current) ro.observe(rail.current);
    document.fonts?.ready.then(place);
    return () => ro.disconnect();
  }, [current]);

  const item = ({ href, label, icon: Icon }: (typeof primary)[number]) => (
    <li key={href}>
      <Link
        href={href}
        onClick={onClick(href)}
        aria-current={active(href) ? "page" : undefined}
        className={cn(
          "relative z-10 flex items-center gap-3 rounded-md px-3 py-2 text-[14px] transition-colors duration-150",
          active(href) ? "font-semibold text-text" : "text-muted hover:bg-surface-3/70 hover:text-text",
        )}
      >
        <Icon size={18} strokeWidth={active(href) ? 2 : 1.75} className={active(href) ? "text-accent" : undefined} />
        {label}
      </Link>
    </li>
  );
  const mobileIndex = primary.findIndex((p) => active(p.href));

  return (
    <>
      {/* Desktop: a grey sidebar; the current page's marker slides when it changes */}
      <nav
        className="fixed inset-y-0 left-0 z-20 hidden w-64 flex-col border-r border-border bg-surface-2 px-4 py-6 md:flex"
        aria-label="Main"
      >
        <Link href="/" onClick={onClick("/")} className="flex items-center gap-2.5 rounded-md px-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-md bg-accent text-accent-ink">
            <GraduationCap size={18} />
          </span>
          <span className="font-display text-[19px] leading-none">Amity Exams</span>
        </Link>
        <ModePill className="ml-2 mt-4 self-start" />
        <button
          type="button"
          onClick={openCommandPalette}
          className="mb-5 mt-4 flex h-9 items-center gap-2.5 rounded-md border border-border bg-surface px-3 text-sm text-muted transition-colors duration-150 hover:border-[#cfd4dc] hover:text-text"
        >
          <Search size={16} aria-hidden />
          <span className="flex-1 text-left">Search</span>
          <kbd className="rounded border border-border bg-surface-2 px-1.5 font-sans text-[11px]">Ctrl K</kbd>
        </button>
        <div ref={rail} className="relative flex flex-1 flex-col">
          {pill && (
            <span
              aria-hidden
              className={cn(
                "absolute inset-x-0 top-0 rounded-md border border-border bg-surface",
                pill.glide && "transition-[transform,height] duration-200 ease-out",
              )}
              style={{ transform: `translateY(${pill.y}px)`, height: pill.h }}
            >
              <span className="absolute -left-px top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-accent" />
            </span>
          )}
          <ul className="space-y-1">{primary.map(item)}</ul>
          <ul className="mt-auto space-y-1 border-t border-border pt-4">{secondary.map(item)}</ul>
        </div>
      </nav>

      {/* Mobile: five-item bottom bar; Progress and Settings live in the Today header */}
      <nav
        className="fixed inset-x-0 bottom-0 z-20 flex border-t border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
        aria-label="Main"
      >
        {mobileIndex >= 0 && (
          <span
            aria-hidden
            className="absolute top-0 left-0 flex w-1/5 justify-center transition-transform duration-200 ease-out"
            style={{ transform: `translateX(${mobileIndex * 100}%)` }}
          >
            <span className="h-0.5 w-8 rounded-full bg-accent" />
          </span>
        )}
        {primary.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            onClick={onClick(href)}
            aria-current={active(href) ? "page" : undefined}
            className={cn(
              "relative flex flex-1 flex-col items-center gap-1 pb-2 pt-2.5 text-[11px] transition-colors duration-150",
              active(href) ? "font-semibold text-accent" : "text-muted",
            )}
          >
            <Icon size={20} strokeWidth={active(href) ? 2.1 : 1.75} />
            {label}
          </Link>
        ))}
      </nav>
      {process.env.NODE_ENV === "development" && <DevWarmup routes={ROUTES} />}
    </>
  );
}
