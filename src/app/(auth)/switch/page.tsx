import type { Metadata } from "next";
import { Suspense } from "react";
import { SwitchScreen } from "@/components/auth/screens/switch";
import { AuthShell } from "@/components/auth/shell";

export const metadata: Metadata = { title: "Switch profile – Amity Exams", robots: { index: false } };

export default function SwitchPage() {
  // Suspense: the screen reads ?next=, which a static page only knows in the browser.
  return (
    <Suspense fallback={<AuthShell title="Checking your sign-in">{null}</AuthShell>}>
      <SwitchScreen />
    </Suspense>
  );
}
