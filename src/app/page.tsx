import { App } from "@/components/app";
import { AppStateProvider } from "@/components/app-state";

/**
 * Rendered per request, so the CSP nonce can be stamped on Next's own scripts.
 *
 * This page was prerendered at build time, which is the right default and was
 * fatally wrong here: the HTML is generated before any request exists, so
 * there is no nonce to write into it. The proxy still added one to the header
 * of every response, and the two never matched — the cached inline bootstrap
 * script carried no nonce, the browser blocked it, and the whole app sat there
 * as a picture with nothing clickable.
 *
 * Nothing is lost. Everything below this line is a client component, so the
 * prerender was an empty shell either way.
 */
export const dynamic = "force-dynamic";

export default function Home() {
  return (
    <main className="w-full flex items-center justify-center py-8">
      <div
        className="relative overflow-hidden bg-white"
        style={{
          width: 385,
          height: 780,
          borderRadius: 44,
          border: "9px solid #16304E",
          boxShadow: "0 40px 90px -30px rgba(22,48,78,0.45)",
        }}
      >
        <AppStateProvider>
          <App />
        </AppStateProvider>
      </div>
    </main>
  );
}
