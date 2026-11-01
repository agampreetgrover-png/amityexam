import type { Metadata } from "next";
import { Suspense } from "react";
import { SignInScreen } from "@/components/auth/screens/sign-in";
import { AuthShell } from "@/components/auth/shell";

export const metadata: Metadata = { title: "Sign in to Amity Exams", robots: { index: false } };

export default function LoginPage() {
  // Suspense: the screen reads ?reason= and ?next=, which a static page only knows in the browser.
  return (
    // The fallback is what the prerendered HTML shows before the browser has the query: the frame and heading, not a blank page.
    <Suspense fallback={<AuthShell title="Sign in">{null}</AuthShell>}>
      <SignInScreen />
    </Suspense>
  );
}
