// A template (unlike a layout) remounts on every navigation, which is what lets each page play its entrance:
// the page's blocks rise in, one after another, as they appear (.page-enter in globals.css).
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="page-enter">{children}</div>;
}
