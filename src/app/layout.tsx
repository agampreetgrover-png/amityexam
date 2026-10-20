import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque } from "next/font/google";
import { Nav } from "@/components/nav";
import { Notifier } from "@/components/notifier";
import "./globals.css";

const bricolage = Bricolage_Grotesque({ variable: "--font-bricolage", subsets: ["latin"], axes: ["opsz", "wdth"] });

export const metadata: Metadata = {
  title: "Amity Exams",
  description: "Personal exam planner and AI study helper",
  applicationName: "Amity Exams",
  appleWebApp: { capable: true, title: "Amity Exams", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: "#f7f8fc",
  colorScheme: "light",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${bricolage.variable} font-sans antialiased`}>
        <Nav />
        <Notifier />
        <div className="md:pl-64">
          <main className="mx-auto max-w-5xl px-4 pb-28 pt-6 md:px-10 md:pb-16 md:pt-10">{children}</main>
        </div>
      </body>
    </html>
  );
}
