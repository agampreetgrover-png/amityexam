import type { Metadata } from "next";
import { SignUpScreen } from "@/components/auth/screens/sign-up";

export const metadata: Metadata = { title: "Create an account for Amity Exams", robots: { index: false } };

export default function SignUpPage() {
  return <SignUpScreen />;
}
