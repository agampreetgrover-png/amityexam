import type { Metadata } from "next";
import { ForgotPasswordScreen } from "@/components/auth/screens/forgot-password";

export const metadata: Metadata = { title: "Reset your Amity Exams password", robots: { index: false } };

export default function ForgotPasswordPage() {
  return <ForgotPasswordScreen />;
}
