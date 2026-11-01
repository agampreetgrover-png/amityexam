// The account screens: sign-in, sign-up, email confirmation, password reset and switching profiles.
// Deliberately outside the (app) group: no browser database is opened here, no app navigation is shown, and no
// Drive sync or reminders run. Every page is the same for every visitor (nothing reads cookies on the server), and
// the service worker never caches these paths (src/lib/sw-rules.ts).
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return children;
}
