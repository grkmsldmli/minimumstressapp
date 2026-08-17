"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";

import { SPACE_TYPES, spaceTypeBySlug } from "@/lib/space-types";

/**
 * The honest answer to an empty search.
 *
 * A marketplace with nothing in it can either say "no results" and lose the
 * person, or say "not yet — tell us what you need and we will write when there
 * is one". The second is the same sentence with a use: it keeps somebody who
 * would otherwise never come back, and it is the only thing here that turns
 * an empty search into something a host can be shown.
 *
 * It is prefilled from the search that got here, so the common case is one
 * button. Asking somebody to retype what they just typed is how a form like
 * this collects nothing.
 *
 * The email is optional and says why it is wanted. A request without one still
 * counts — the number is what recruits a host — so there is no reason to make
 * it the price of being heard.
 */

type State = "idle" | "sending" | "done";

export function RequestSpace() {
  const params = useSearchParams();

  const [type, setType] = useState(() => spaceTypeBySlug(params.get("type") ?? "")?.slug ?? "");
  const [where, setWhere] = useState(() => (params.get("where") ?? "").trim().slice(0, 60));
  const [email, setEmail] = useState("");
  const [state, setState] = useState<State>("idle");
  const [error, setError] = useState<string | null>(null);

  const send = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);

    if (!where.trim()) {
      setError("Which town are you looking in?");
      return;
    }

    setState("sending");
    try {
      const response = await fetch("/api/spaces/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spaceType: type || null, lookingIn: where.trim(), email }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        // The server's own words: it knows whether this was a bad town, too
        // many tries, or its own database falling over.
        setError(body.error ?? "We could not record that just now.");
        setState("idle");
        return;
      }

      setState("done");
    } catch {
      setError("Check your connection and try again.");
      setState("idle");
    }
  };

  if (state === "done") {
    return (
      <div
        className="mt-8 rounded-2xl p-6"
        style={{ backgroundColor: "#f0faf6", border: "1px solid #cfeadd" }}
        role="status"
      >
        {/* No "thank you" — the app does not have an attitude about being
            told things, and copy.test.ts holds the line on that. */}
        <p className="text-[16px]" style={{ color: "#1a5c3a" }}>
          Noted.
        </p>
        <p className="mt-2 text-[15px] leading-[1.75]" style={{ color: "#1a5c3a" }}>
          {email
            ? "We will write when there is a room that fits, and not about anything else."
            : "It counts even without an address — this is how we decide which towns to open next."}
        </p>
      </div>
    );
  }

  return (
    <form
      onSubmit={send}
      className="mt-8 rounded-2xl p-6"
      style={{ backgroundColor: "#f8fbfd", border: "1px solid #e7eef6" }}
    >
      <h2 className="text-[19px]" style={{ color: "#0F2F55" }}>
        Tell us what you need
      </h2>
      <p className="mt-2 text-[15px] leading-[1.75]" style={{ color: "#5f6673" }}>
        We will write when there is a room that fits. It also decides which towns we open next —
        rooms get listed where people are asking.
      </p>

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="block text-[11px] uppercase tracking-[0.1em]" style={{ color: "#8a94a3" }}>
            What you need
          </span>
          <select
            value={type}
            onChange={(event) => setType(event.target.value)}
            className="mt-1.5 w-full rounded-xl bg-white px-3.5 py-3 text-[15px] outline-none"
            style={{ border: "1px solid #e7eef6", color: "#0F2F55" }}
          >
            <option value="">Any space</option>
            {SPACE_TYPES.map((space) => (
              <option key={space.slug} value={space.slug}>
                {space.label}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="block text-[11px] uppercase tracking-[0.1em]" style={{ color: "#8a94a3" }}>
            Where
          </span>
          <input
            value={where}
            onChange={(event) => setWhere(event.target.value)}
            placeholder="San Mateo, CA"
            autoComplete="address-level2"
            className="mt-1.5 w-full rounded-xl bg-white px-3.5 py-3 text-[15px] outline-none"
            style={{ border: "1px solid #e7eef6", color: "#0F2F55" }}
          />
        </label>
      </div>

      <label className="mt-3 block">
        <span className="block text-[11px] uppercase tracking-[0.1em]" style={{ color: "#8a94a3" }}>
          Email <span className="normal-case tracking-normal">(optional)</span>
        </span>
        <input
          type="email"
          inputMode="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@example.com"
          className="mt-1.5 w-full rounded-xl bg-white px-3.5 py-3 text-[15px] outline-none"
          style={{ border: "1px solid #e7eef6", color: "#0F2F55" }}
        />
      </label>

      {error && (
        <p className="mt-3 text-[13.5px]" style={{ color: "#C0392B" }} role="alert">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={state === "sending"}
        className="mt-4 rounded-full px-7 py-3.5 text-[15px] font-medium text-white disabled:opacity-60"
        style={{ backgroundColor: "#0F2F55" }}
      >
        {state === "sending" ? "Sending…" : "Tell us"}
      </button>

      <p className="mt-3 text-[13px] leading-[1.7]" style={{ color: "#8a94a3" }}>
        One email when there is a room, and nothing else. No list.
      </p>
    </form>
  );
}
