import Link from "next/link";
import { WifiOff } from "lucide-react";

export default function Offline() {
  return (
    <div className="max-w-md py-10 md:py-16">
      <WifiOff size={18} className="text-muted" aria-hidden />
      <h1 className="mt-3 font-display text-[28px] leading-tight md:text-[32px]">You&apos;re offline</h1>
      <p className="mt-2 text-[15px] leading-relaxed text-muted">
        This page hasn&apos;t been opened on this device yet. Your subjects, exams and exam kits still work offline.
      </p>
      {/* A primary Button's classes, copied: this is a server page and can't call buttonClass from the client-only ui.tsx. */}
      <Link
        href="/"
        className="press mt-5 inline-flex h-9 select-none items-center justify-center gap-1.5 rounded-lg bg-accent px-3.5 text-sm font-medium text-accent-ink shadow-[inset_0_1px_0_rgb(255_255_255/0.14),var(--shadow-control)] hover:bg-accent-hover"
      >
        Go to Today
      </Link>
    </div>
  );
}
