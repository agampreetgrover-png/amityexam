"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLayoutEffect, useRef, useState, type MouseEvent } from "react";
import { BarChart3, BookOpen, GraduationCap, House, Moon, Search, Settings, Sun } from "lucide-react";
import { openCommandPalette } from "./command-palette-loader";
import { setTheme, useTheme } from "@/lib/theme";
import { DevWarmup } from "./dev-warmup";
import { ModePill } from "./mode-pill";
import { cn } from "./ui";

const primary = [
  { href: "/", label: "Today", icon: House },
  { href: "/subjects", label: "Subjects", icon: BookOpen },
  { href: "/exams", label: "Exams", icon: GraduationCap },
];
const secondary = [
  { href: "/progress", label: "Progress", icon: BarChart3 },
  { href: "/settings", label: "Settings", icon: Settings },
];
const ROUTES = [...primary, ...secondary].map((i) => i.href);

const iconButton =
  "press flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-surface-2 hover:text-text";

export function Nav() {
  const path = usePathname();
  const { resolved: theme } = useTheme();
  // The clicked item lights up straight away, before the next page has loaded. It only counts while we're still
  // on the page it was clicked from, so it clears itself once the navigation lands (or a later one does).
  const [clicked, setClicked] = useState<{ href: string; from: string } | null>(null);
  const current = clicked?.from === path ? clicked.href : path;
  const active = (href: string) => (href === "/" ? current === "/" : current.startsWith(href));
  const onClick = (href: string) => (e: MouseEvent) => {
    if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || e.button !== 0) return; // opens a new tab or window
    setClicked({ href, from: path });
  };

  // The current page sits on a soft blue pill that glides to whichever item is active, across both groups.
  // On first load (and when the window or fonts re-measure it) it just appears. It's measured inside the bar,
  // so the mode switch loading in doesn't throw it off.
  const rail = useRef<HTMLDivElement>(null);
  const [pill, setPill] = useState<{ x: number; w: number; glide: boolean } | null>(null);
  useLayoutEffect(() => {
    const place = () => {
      const nav = rail.current;
      const on = nav?.querySelector<HTMLElement>('[aria-current="page"]');
      if (!nav || !on) return setPill(null);
      const a = on.getBoundingClientRect();
      const b = nav.getBoundingClientRect();
      setPill((p) => ({ x: a.left - b.left, w: a.width, glide: p != null }));
    };
    place();
    // Labels show or hide with the window width, and a late font swap changes their size.
    const ro = new ResizeObserver(place);
    if (rail.current) ro.observe(rail.current);
    document.fonts?.ready.then(place);
    return () => ro.disconnect();
  }, [current]);

  // Today, Subjects and Exams get a label once there's room; Progress and Settings stay as icons on the right.
  const item = ({ href, label, icon: Icon }: (typeof primary)[number], labelled: boolean) => {
    const on = active(href);
    return (
      <li key={href}>
        <Link
          href={href}
          onClick={onClick(href)}
          aria-current={on ? "page" : undefined}
          aria-label={label}
          title={labelled ? undefined : label}
          className={cn(
            "press relative z-10 flex h-8 items-center gap-2 rounded-lg text-[14px] font-medium",
            labelled ? "px-2.5 lg:px-3" : "w-8 justify-center",
            on ? "text-accent" : "text-muted hover:bg-surface-2 hover:text-text",
          )}
        >
          <Icon size={17} strokeWidth={on ? 2.1 : 1.8} className="transition-[stroke-width] duration-150" />
          {labelled && <span className="hidden lg:inline">{label}</span>}
        </Link>
      </li>
    );
  };
  const mobileIndex = primary.findIndex((p) => active(p.href));

  return (
    <>
      {/* Desktop: a slim bar over the page, ruled off by a hairline; the page column lines up under it. */}
      <nav
        className="sticky top-0 z-20 hidden h-14 border-b border-border bg-surface/85 backdrop-blur-md backdrop-saturate-150 md:block"
        aria-label="Main"
      >
        <div ref={rail} className="relative mx-auto flex h-full max-w-5xl items-center gap-2 px-8">
          {pill && (
            <span
              aria-hidden
              className={cn(
                "pointer-events-none absolute left-0 top-3 h-8 rounded-lg bg-accent-soft",
                pill.glide && "transition-[transform,width] duration-250 ease-snappy",
              )}
              style={{ transform: `translateX(${pill.x}px)`, width: pill.w }}
            />
          )}
          <Link href="/" onClick={onClick("/")} className="group mr-4 flex shrink-0 items-center gap-2.5 rounded-lg lg:mr-6">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent text-accent-ink shadow-[inset_0_1px_0_rgb(255_255_255/0.18)] transition-transform duration-200 ease-snappy group-hover:-rotate-6">
              <GraduationCap size={16} strokeWidth={2} />
            </span>
            <span className="text-[15px] font-semibold tracking-[-0.02em]">Amity Exams</span>
          </Link>
          <ul className="flex items-center gap-0.5">{primary.map((i) => item(i, true))}</ul>
          {/* Right-aligned on its own, so Progress and Settings don't move when the mode switch loads in. */}
          <div className="ml-auto flex items-center gap-2">
            <ModePill className="shrink-0" />
            <button
              type="button"
              onClick={openCommandPalette}
              aria-label="Search"
              className="press ml-1 flex h-8 shrink-0 items-center gap-2 rounded-lg border border-border bg-surface px-2.5 text-[13px] text-muted shadow-control hover:border-line-strong hover:text-text xl:w-52"
            >
              <Search size={15} aria-hidden />
              <span className="hidden flex-1 text-left xl:inline">Search</span>
              <kbd className="hidden rounded-md bg-surface-2 px-1.5 py-px font-sans text-[11px] font-medium text-muted ring-1 ring-inset ring-border lg:inline">Ctrl K</kbd>
            </button>
            {/* Flips to the other theme and pins it; Settings can put it back to following the device. */}
            <button
              type="button"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
              title={theme === "dark" ? "Light theme" : "Dark theme"}
              className={cn(iconButton, "[&_svg]:transition-transform [&_svg]:duration-300 [&_svg]:ease-snappy hover:[&_svg]:rotate-[-18deg]")}
            >
              {theme === "dark" ? <Sun size={17} strokeWidth={1.8} /> : <Moon size={17} strokeWidth={1.8} />}
            </button>
            <span aria-hidden className="mx-0.5 h-5 w-px bg-border" />
            <ul className="flex items-center gap-0.5">{secondary.map((i) => item(i, false))}</ul>
          </div>
        </div>
      </nav>

      {/* Mobile: three-item bottom bar; Progress and Settings live in the Today header. The current item's icon
          sits on a soft pill that slides between them. */}
      <nav
        className="fixed inset-x-0 bottom-0 z-20 flex border-t border-border bg-surface/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-md backdrop-saturate-150 md:hidden"
        aria-label="Main"
      >
        {mobileIndex >= 0 && (
          <span
            aria-hidden
            className="absolute left-0 top-2 flex w-1/3 justify-center transition-transform duration-250 ease-snappy"
            style={{ transform: `translateX(${mobileIndex * 100}%)` }}
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
