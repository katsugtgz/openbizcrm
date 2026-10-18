/**
 * Route-group transition: fades app content in on every navigation inside
 * (app). Chosen over <ViewTransition> because that API is still gated to the
 * experimental channel in React 19.3 (package exports it only under the
 * experimental condition) — upgrade path: swap this file for
 * <ViewTransition> wrapping children once stable.
 */
export default function AppTemplate({
  children,
}: {
  children: import("react").ReactNode;
}) {
  return <div className="animate-in fade-in duration-300">{children}</div>;
}
