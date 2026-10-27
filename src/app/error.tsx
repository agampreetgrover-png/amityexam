"use client";

import Link from "next/link";
import { useEffect } from "react";
import { TriangleAlert } from "lucide-react";
import { Button, Empty } from "@/components/ui";

/** A crash on one page (say, an odd record from an old backup) leaves the nav working instead of a blank app. */
export default function PageError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <Empty icon={<TriangleAlert />} title="This page couldn't be shown">
      <p className="text-sm text-muted">Something in your data tripped it up. Your other pages and data are fine.</p>
      <div className="mt-3 flex gap-2">
        <Button size="sm" onClick={reset}>Try again</Button>
        <Link href="/settings" className="inline-flex items-center px-2 text-sm text-accent underline underline-offset-2">Settings → backup</Link>
      </div>
    </Empty>
  );
}
