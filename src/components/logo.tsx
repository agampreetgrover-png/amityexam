/**
 * The app's mark: an A for Amity whose crossbar is a tick, drawn in currentColor on a 24-unit grid so it sits in
 * the same tiles as the Lucide icons. The app icons (scripts/make-icons.mjs) draw the same two paths.
 */
export function LogoMark({ size = 17, className }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={2.3} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M4.5 20.5L12 3.5l7.5 17" />
      <path d="M8.2 14.6l2.6 2.6 4.6-5.2" />
    </svg>
  );
}
