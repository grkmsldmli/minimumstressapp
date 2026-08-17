"use client";

import { useState } from "react";

import { looksLikeEmail } from "@/lib/result-email";

/**
 * What somebody can do with a result once they have it.
 *
 * The order is the argument. The result is already on the screen above this;
 * these are offers, not a gate. The pages this replaces put an email field
 * between a person and the score they had just spent four minutes earning —
 * which collects addresses without collecting anybody who wants to hear from
 * you, and a good share of what it collects is typed to get past the door.
 */

type State = "idle" | "sending" | "sent";

/**
 * What goes in the message.
 *
 * The whole result, not the number. Each tool already works out which
 * dimension is thinnest and what the band means; sending only a score turns
 * four minutes of answering into a receipt for something the reader has
 * already read.
 *
 * The related tools are not here. The server picks those from its own list, so
 * a link in somebody's inbox cannot be chosen by whatever posted to the
 * endpoint.
 */
export interface ResultPayload {
  toolName: string;
  score: string;
  band: string;
  summary: string;
  headline?: string;
  story?: string;
  /** 0–100 each, with the one to start on marked. */
  dimensions?: { label: string; value: number; focus?: boolean }[];
  insights?: string[];
  focus?: { label: string; action: string };
  steps?: string[];
  /** The tool's own slug, which is how the server picks what else to suggest. */
  slug?: string;
}

export function ResultActions({ result, accent }: { result: ResultPayload; accent: string }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<State>("idle");
  const [error, setError] = useState<string | null>(null);
  const [shared, setShared] = useState<string | null>(null);

  const send = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    if (!looksLikeEmail(email)) {
      setError("That does not look like an email address.");
      return;
    }

    setState("sending");
    try {
      const response = await fetch("/api/tools/result", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        /*
         * No URL. The obvious version sends `window.location.href` for the
         * button in the message, and the server ignores it on purpose: an open
         * endpoint that mails a link of the caller's choosing to an address of
         * the caller's choosing, from us, is a phishing relay. It builds every
         * link from the slug instead.
         */
        body: JSON.stringify({ ...result, email }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        // The server's own words. It knows whether this was a bad address, too
        // many tries, or its own mail provider falling over, and each of those
        // wants a different thing from the reader.
        setError(body.error ?? "We could not send that just now.");
        setState("idle");
        return;
      }

      setState("sent");
    } catch {
      setError("Check your connection and try again.");
      setState("idle");
    }
  };

  /*
   * The share sheet where there is one, the clipboard where there is not.
   *
   * navigator.share is missing on desktop Firefox and most desktop Chrome, and
   * a button that silently does nothing is worse than no button. Copying the
   * link is the same job with one more step, and saying so is what makes it
   * obvious the tap worked.
   *
   * What is shared is the tool, not the score. Somebody's burnout result is
   * theirs, and a share sheet is one mis-tap from a group chat.
   */
  const share = async () => {
    setShared(null);
    const url = window.location.href;
    const text = `${result.toolName} — free, and it does not ask for your email first.`;

    if (navigator.share) {
      try {
        await navigator.share({ title: result.toolName, text, url });
        return;
      } catch {
        // Dismissed, or refused. Falling through to the clipboard would be
        // rude — they closed it on purpose.
        return;
      }
    }

    try {
      await navigator.clipboard.writeText(url);
      setShared("Link copied.");
    } catch {
      setShared("Copy the address from the bar above to share it.");
    }
  };

  return (
    <div className="mt-6 space-y-3">
      {state === "sent" ? (
        <p
          className="rounded-xl p-5 text-[14.5px] leading-[1.7]"
          style={{ backgroundColor: "#f0faf6", border: "1px solid #cfeadd", color: "#1a5c3a" }}
          role="status"
        >
          Sent to {email}. If it is not there in a minute, check the spam folder — it is the
          first message we have sent you.
        </p>
      ) : (
        <form
          onSubmit={send}
          className="rounded-xl p-5"
          style={{ backgroundColor: "#f8fbfd", border: "1px solid #e7eef6" }}
        >
          <label htmlFor="result-email" className="block text-[14px] font-medium" style={{ color: "#1a2744" }}>
            Send this result to yourself
          </label>
          <p className="mt-1 text-[13.5px] leading-[1.6]" style={{ color: "#8a94a3" }}>
            One email, with what is on this page. No list, no follow-ups.
          </p>

          <div className="mt-3 flex flex-wrap gap-2">
            <input
              id="result-email"
              type="email"
              inputMode="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              className="min-w-0 flex-1 rounded-lg px-4 py-3 text-[15px] outline-none"
              style={{ border: "1px solid #e7eef6", color: "#1a2744" }}
            />
            <button
              type="submit"
              disabled={state === "sending"}
              className="rounded-lg px-5 py-3 text-[14.5px] font-medium text-white disabled:opacity-60"
              style={{ backgroundColor: accent }}
            >
              {state === "sending" ? "Sending…" : "Send it"}
            </button>
          </div>

          {error && (
            <p className="mt-2.5 text-[13.5px]" style={{ color: "#C0392B" }} role="alert">
              {error}
            </p>
          )}
        </form>
      )}

      <button
        type="button"
        onClick={share}
        className="w-full rounded-xl py-3 text-[14px]"
        style={{ border: "1px solid #e7eef6", color: "#5f6673" }}
      >
        Share this tool
      </button>

      {shared && (
        <p className="text-center text-[13.5px]" style={{ color: "#8a94a3" }} role="status">
          {shared}
        </p>
      )}
    </div>
  );
}
