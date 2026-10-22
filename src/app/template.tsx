// A template (unlike a layout) remounts on every navigation, which is what lets each page play its entrance:
// a short fade so a route change isn't a hard cut. Motion elsewhere in the app only answers something the student did.
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="page-enter">{children}</div>;
}
