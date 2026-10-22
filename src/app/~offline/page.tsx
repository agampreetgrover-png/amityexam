import Link from "next/link";
import { WifiOff } from "lucide-react";

export default function Offline() {
  return (
    <div className="max-w-md py-10 md:py-16">
      <WifiOff size={18} className="text-muted" aria-hidden />
      <h1 className="mt-3 font-display text-[28px] leading-tight md:text-[32px]">You&apos;re offline</h1>
      <p className="mt-2 text-[15px] leading-relaxed text-muted">
        This page hasn&apos;t been opened on this device yet. Your planner, revision and exam kits still work offline.
      </p>
      <Link
        href="/"
        className="mt-5 inline-flex h-9 items-center rounded-md bg-accent px-3.5 text-sm font-medium text-accent-ink transition-colors duration-150 hover:bg-[#15306a]"
      >
        Go to Today
      </Link>
    </div>
  );
}
