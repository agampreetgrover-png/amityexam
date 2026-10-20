import Link from "next/link";
import { WifiOff } from "lucide-react";

export default function Offline() {
  return (
    <div className="flex flex-col items-start gap-3 py-16">
      <WifiOff size={28} className="text-muted" />
      <h1 className="text-[28px] font-semibold tracking-tight [font-stretch:90%]">You&apos;re offline</h1>
      <p className="max-w-sm text-[15px] leading-relaxed text-muted">
        This page hasn&apos;t been opened on this device yet. Your planner, revision and exam kits still work offline.
      </p>
      <Link href="/" className="font-medium underline underline-offset-2">Go to Today</Link>
    </div>
  );
}
