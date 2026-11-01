import type { Metadata } from "next";
import { CheckEmailScreen } from "@/components/auth/screens/check-email";

export const metadata: Metadata = { title: "Confirm your email for Amity Exams", robots: { index: false } };

export default function CheckEmailPage() {
  return <CheckEmailScreen />;
}
