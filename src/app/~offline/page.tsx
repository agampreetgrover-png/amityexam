import Link from "next/link";
import { WifiOff } from "lucide-react";

export default function Offline() {
  return (
    <div className="py-10 md:py-16">
      <section className="flex max-w-md flex-col items-start gap-3 rounded-2xl border border-border bg-surface p-6 shadow-[0_1px_3px_rgb(17_24_39/0.04)] sm:p-8">
        <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent-soft text-accent">
          <WifiOff size={24} />
        </span>
        <h1 className="mt-1 text-[28px] font-bold leading-tight tracking-tight">You&apos;re offline</h1>
        <p className="text-[15px] leading-relaxed text-muted">
          This page hasn&apos;t been opened on this device yet. Your planner, revision and exam kits still work offline.
        </p>
        <Link href="/" className="mt-2 inline-flex h-10 items-center rounded-lg bg-accent px-4 text-sm font-medium text-accent-ink hover:opacity-90">
          Go to Today
        </Link>
      </section>
    </div>
  );
}
