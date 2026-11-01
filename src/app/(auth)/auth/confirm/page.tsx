import type { Metadata } from "next";
import { Suspense } from "react";
import { ConfirmScreen } from "@/components/auth/screens/confirm";

export const metadata: Metadata = { title: "Confirm your email – Amity Exams", robots: { index: false } };

export default function ConfirmPage() {
  // Suspense: the screen reads ?token_hash= and ?type=, which a static page only knows in the browser. Nothing here
  // reads the request on the server, and opening the page sends nothing: the link is used only when the button is pressed.
  return (
    <Suspense>
      <ConfirmScreen />
    </Suspense>
  );
}
