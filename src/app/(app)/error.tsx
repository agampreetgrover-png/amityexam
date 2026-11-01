"use client";

import Link from "next/link";
import { useEffect } from "react";
import { RotateCw, TriangleAlert } from "lucide-react";
import { Button, buttonClass } from "@/components/ui";

/** A crash on one page (say, an odd record from an old backup) leaves the nav working instead of a blank app. */
export default function PageError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  // Set like the offline page: a plain heading and a way on, not the dashed box that means "nothing here yet".
  return (
    <div role="alert" className="max-w-md py-10 md:py-16">
      <TriangleAlert size={18} className="text-warn" aria-hidden />
      <h1 className="mt-3 text-balance font-display text-[28px] leading-tight md:text-[32px]">This page couldn&apos;t be shown</h1>
      <p className="mt-2 text-[15px] leading-relaxed text-muted">Something in your data tripped it up. Your other pages and data are fine.</p>
      <div className="mt-5 flex flex-wrap gap-2">
        <Button onClick={reset}><RotateCw size={15} aria-hidden /> Try again</Button>
        <Link href="/settings" className={buttonClass("secondary")}>Back up in Settings</Link>
      </div>
    </div>
  );
}
