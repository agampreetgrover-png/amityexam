"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from "react";
import { BarChart3, BookOpen, Flame, GraduationCap, House, MessagesSquare, Moon, Search, Settings, Sprout, Sun } from "lucide-react";
import { openCommandPalette } from "./command-palette-loader";
import { setTheme, useTheme } from "@/lib/theme";
import { DevWarmup } from "./dev-warmup";
import { ModePill } from "./mode-pill";
import { cn } from "./ui";

const primary = [
  { href: "/", label: "Today", icon: House },
  { href: "/subjects", label: "Subjects", icon: BookOpen },
  { href: "/chat", label: "Chat", icon: MessagesSquare },
  { href: "/important", label: "Important", icon: Flame },
  { href: "/zero-prep", label: "Zero prep", icon: Sprout },
  { href: "/exams", label: "Exams", icon: GraduationCap },
];
const secondary = [
  { href: "/progress", label: "Progress", icon: BarChart3 },
  { href: "/settings", label: "Settings", icon: Settings },
];
// In the sidebar every destination is a row in one list; the mobile bar still shows only the primary ones.
const sidebar = [...primary, ...secondary];
const ROUTES = sidebar.map((i) => i.href);

export function Nav() {
  const path = usePathname();
  const { resolved: theme } = useTheme();
  // The clicked item lights up straight away, before the next page has loaded. It only counts while we're still
  // on the page it was clicked from, so it clears itself once the navigation lands (or a later one does).
  const [clicked, setClicked] = useState<{ href: string; from: string } | null>(null);
  // Forgotten once the navigation lands, so coming Back to the page it was clicked from doesn't light it up again.
  useEffect(() => setClicked(null), [path]);
  const current = clicked?.from === path ? clicked.href : path;
  const active = (href: string) => (href === "/" ? current === "/" : current.startsWith(href));
  const onClick = (href: string) => (e: MouseEvent) => {
    if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || e.button !== 0) return; // opens a new tab or window
    setClicked({ href, from: path });
  };

  // The current page sits on a soft blue pill that glides down the rail to whichever item is active.
  // On first load (and when the window or fonts re-measure it) it just appears. It's measured inside the rail,
  // so the controls at the foot loading in don't throw it off.
  const rail = useRef<HTMLDivElement>(null);
  const [pill, setPill] = useState<{ y: number; h: number; glide: boolean } | null>(null);
  useLayoutEffect(() => {
    const place = () => {
      const nav = rail.current;
      const on = nav?.querySelector<HTMLElement>('[aria-current="page"]');
      if (!nav || !on) return setPill(null);
      const a = on.getBoundingClientRect();
      const b = nav.getBoundingClientRect();
      setPill((p) => ({ y: a.top - b.top, h: a.height, glide: p != null }));
    };
    place();
    // Labels show or hide with the window width, and a late font swap changes the rows' height.
    const ro = new ResizeObserver(place);
    if (rail.current) ro.observe(rail.current);
    document.fonts?.ready.then(place);
    return () => ro.disconnect();
  }, [current]);

  // One row in the sidebar: the icon always, the label once the sidebar is wide enough (lg+).
  const item = ({ href, label, icon: Icon }: (typeof sidebar)[number]) => {
    const on = active(href);
    return (
      <li key={href}>
        <Link
          href={href}
          onClick={onClick(href)}
          aria-current={on ? "page" : undefined}
          aria-label={label}
          title={label}
          className={cn(
            "press relative z-10 flex h-9 items-center gap-3 rounded-lg text-[14px] font-medium",
            "justify-center lg:justify-start lg:px-3",
            on ? "text-accent" : "text-muted hover:bg-surface-2 hover:text-text",
          )}
        >
          <Icon size={18} strokeWidth={on ? 2.1 : 1.8} className="shrink-0 transition-[stroke-width] duration-150" />
          <span className="hidden lg:inline">{label}</span>
        </Link>
      </li>
    );
  };
  const mobileIndex = primary.findIndex((p) => active(p.href));

  return (
    <>
      {/* Desktop: a vertical sidebar down the left edge, ruled off by a hairline; a narrow icon rail that widens
          to show labels on large screens. The page column sits to its right. */}
      <nav
        // box-content: a landscape notch's inset is added outside the rail's width, so the icons clear it.
        className="fixed inset-y-0 left-0 z-20 box-content hidden w-16 flex-col border-r pl-[env(safe-area-inset-left)] border-border bg-surface/85 backdrop-blur-md backdrop-saturate-150 md:flex lg:w-60"
        aria-label="Main"
      >
        <Link href="/" onClick={onClick("/")} aria-label="Amity Exams" title="Amity Exams" className="group flex h-14 shrink-0 items-center gap-2.5 px-3 lg:px-5">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-ink shadow-[inset_0_1px_0_rgb(255_255_255/0.18)] transition-transform duration-200 ease-snappy group-hover:-rotate-6">
            <GraduationCap size={16} strokeWidth={2} />
          </span>
          <span className="hidden text-[15px] font-semibold tracking-[-0.02em] lg:inline">Amity Exams</span>
        </Link>

        <div ref={rail} className="relative flex-1 overflow-y-auto px-2 py-2 lg:px-3">
          {pill && (
            <span
              aria-hidden
              className={cn(
                "pointer-events-none absolute inset-x-2 top-0 rounded-lg bg-accent-soft lg:inset-x-3",
                pill.glide && "transition-[transform,height] duration-250 ease-snappy",
              )}
              style={{ transform: `translateY(${pill.y}px)`, height: pill.h }}
            />
          )}
          <ul className="space-y-0.5">{sidebar.map(item)}</ul>
        </div>

        {/* Pinned at the foot: the exam-mode switch (when there's room for it), search, and the theme toggle. */}
        <div className="shrink-0 space-y-2 border-t border-border p-2 lg:p-3">
          <div className="hidden justify-center lg:flex">
            <ModePill />
          </div>
          <div className="flex flex-col gap-1 lg:flex-row">
            <button
              type="button"
              onClick={openCommandPalette}
              aria-label="Search"
              title="Search"
              className="press flex h-9 w-full items-center justify-center gap-2 rounded-lg border border-border bg-surface text-[13px] text-muted shadow-control hover:border-line-strong hover:text-text lg:flex-1 lg:justify-start lg:px-2.5"
            >
              <Search size={16} aria-hidden className="shrink-0" />
              <span className="hidden flex-1 text-left lg:inline">Search</span>
              <kbd className="hidden rounded-md bg-surface-2 px-1.5 py-px font-sans text-[11px] font-medium text-muted ring-1 ring-inset ring-border lg:inline">Ctrl K</kbd>
            </button>
            {/* Flips to the other theme and pins it; Settings can put it back to following the device. */}
            <button
              type="button"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
              title={theme === "dark" ? "Light theme" : "Dark theme"}
              className={cn(
                "press flex h-9 w-full items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-text lg:w-9",
                "[&_svg]:transition-transform [&_svg]:duration-300 [&_svg]:ease-snappy hover:[&_svg]:rotate-[-18deg]",
              )}
            >
              {theme === "dark" ? <Sun size={17} strokeWidth={1.8} /> : <Moon size={17} strokeWidth={1.8} />}
            </button>
          </div>
        </div>
      </nav>

      {/* Mobile: bottom bar of the primary items; Progress and Settings live in the Today header. The current item's icon
          sits on a soft pill that slides between them. */}
      <nav
        className="fixed inset-x-0 bottom-0 z-20 flex border-t border-border bg-surface/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-md backdrop-saturate-150 md:hidden"
        aria-label="Main"
      >
        {mobileIndex >= 0 && (
          <span
            aria-hidden
            className="absolute left-0 top-2 flex justify-center transition-transform duration-250 ease-snappy"
            style={{ width: `${100 / primary.length}%`, transform: `translateX(${mobileIndex * 100}%)` }}
          >
            <span className="h-7 w-14 rounded-full bg-accent-soft" />
          </span>
        )}
        {primary.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            onClick={onClick(href)}
            aria-current={active(href) ? "page" : undefined}
            className={cn(
              "relative flex flex-1 flex-col items-center gap-1 pb-2 pt-2 text-[11px] transition-colors duration-150",
              active(href) ? "font-semibold text-accent" : "font-medium text-muted",
            )}
          >
            <span className="flex h-7 items-center justify-center">
              <Icon size={20} strokeWidth={active(href) ? 2.1 : 1.75} />
            </span>
            {label}
          </Link>
        ))}
      </nav>
      {process.env.NODE_ENV === "development" && <DevWarmup routes={ROUTES} />}
    </>
  );
}
