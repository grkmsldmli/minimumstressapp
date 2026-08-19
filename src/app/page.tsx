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
    // The phone mockup is desktop-only. On a real phone and in the native shell
    // the app fills the viewport edge to edge — see .app-stage / .app-frame in
    // globals.css, where the frame is gated to 500px and up.
    <main className="app-stage">
      <div className="app-frame">
        <AppStateProvider>
          <App />
        </AppStateProvider>
      </div>
    </main>
  );
}
