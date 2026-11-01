import type { Metadata } from "next";
import { ResetPasswordScreen } from "@/components/auth/screens/reset-password";

export const metadata: Metadata = { title: "Choose a new Amity Exams password", robots: { index: false } };

export default function ResetPasswordPage() {
  return <ResetPasswordScreen />;
}
