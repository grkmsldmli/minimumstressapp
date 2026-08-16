/**
 * Placeholder, so the plumbing can be proved before the page exists.
 *
 * What confirms the routing is that this renders on the content host while the
 * app still renders on the app host, from one deployment. The real homepage
 * replaces this file.
 */
export default function SiteHome() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-24">
      <p
        className="text-[11px] uppercase tracking-[0.18em]"
        style={{ color: "#0EA5E9", fontFamily: "var(--font-dm-sans)" }}
      >
        Minimum Stress
      </p>
      <h1
        className="mt-4 text-[42px] leading-[1.1]"
        style={{ fontFamily: "var(--font-dm-serif)" }}
      >
        The site is being rebuilt here.
      </h1>
      <p className="mt-4 text-[15px] leading-relaxed" style={{ color: "#5f6673" }}>
        Routing is live: this hostname is served by the same deployment as the app, on its
        own typeface and its own pages.
      </p>
    </main>
  );
}
