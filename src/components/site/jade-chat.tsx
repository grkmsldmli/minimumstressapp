"use client";

import { useEffect, useRef, useState } from "react";

import { SUPPORT_EMAIL } from "@/lib/company";
import {
  CHAT_CUSTOMER_URL,
  CHAT_PROXY_URL,
  JADE_GREETING,
  JADE_SYSTEM_PROMPT,
  MAX_MODEL_MESSAGES_PER_DAY,
  QUICK_REPLIES,
  answerLocally,
  detectLanguage,
  extractEmail,
  isDecline,
} from "@/lib/jade";

/**
 * Jade, ported from the Shopify widget she ran in.
 *
 * The design is deliberately the same one — navy bubble, the green heart, the
 * typing that pauses at a full stop. It was recognisable and it worked; what
 * needed replacing was everything she knew, which now lives in lib/jade.ts.
 *
 * The architecture is the thing worth preserving. Most of what somebody asks
 * a front desk is routing, and `answerLocally` handles that from a table
 * without a network call — free, instant, and incapable of inventing a policy.
 * The model is the fallback for real questions, capped per day, and it is the
 * only path that costs anything.
 *
 * Rendered on the marketing site only. The app has its own support routes and
 * a signed-in person asking about a booking should reach those rather than a
 * general assistant.
 */

interface Message {
  role: "user" | "bot";
  text: string;
}

type Intake = "support" | "host_interest" | "email_signup" | null;

const STORAGE_KEY = "ms_jade_model_calls";
const STORAGE_DAY = "ms_jade_model_day";

export function JadeChat() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [intake, setIntake] = useState<Intake>(null);
  const [showChips, setShowChips] = useState(true);

  const scroller = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  /*
   * Kept in a ref rather than state. It feeds the next request and never needs
   * to paint, so putting it in state would re-render the transcript on every
   * turn for nothing.
   */
  const history = useRef<{ role: "user" | "assistant"; content: string }[]>([]);

  useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight;
  }, [messages, busy]);

  const say = (text: string) => {
    history.current = [...history.current, { role: "assistant" as const, content: text }].slice(-10);
    setMessages((prior) => [...prior, { role: "bot", text }]);
  };

  /**
   * The day's allowance, on the model path only.
   *
   * Local answers are not counted — somebody can route themselves around the
   * site all afternoon for nothing. Reset by date rather than by a rolling
   * window, because a person who comes back tomorrow should find a fresh one
   * and nobody needs a timer explained to them.
   */
  const overDailyLimit = (): boolean => {
    try {
      const today = new Date().toISOString().slice(0, 10);
      if (localStorage.getItem(STORAGE_DAY) !== today) {
        localStorage.setItem(STORAGE_DAY, today);
        localStorage.setItem(STORAGE_KEY, "0");
      }
      return Number(localStorage.getItem(STORAGE_KEY) || "0") >= MAX_MODEL_MESSAGES_PER_DAY;
    } catch {
      // Private browsing, storage disabled. Not a reason to refuse anybody.
      return false;
    }
  };

  const countModelCall = () => {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        String(Number(localStorage.getItem(STORAGE_KEY) || "0") + 1),
      );
    } catch {
      /* see above */
    }
  };

  /** Sends a captured lead onward. Never blocks the reply on it. */
  const captureLead = (type: string, email: string, note: string, language: string) => {
    void fetch(CHAT_CUSTOMER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type,
        email,
        message: note,
        conversation: history.current
          .slice(-10)
          .map((m) => `${m.role === "assistant" ? "Jade" : "User"}: ${m.content}`)
          .join("\n\n"),
        page_url: typeof window === "undefined" ? "" : window.location.href,
        language,
        created_at: new Date().toISOString(),
      }),
    }).catch(() => {
      /* A lead we could not forward is not an error the visitor should see. */
    });
  };

  const send = async (raw: string) => {
    const text = raw.trim();
    if (!text || busy) return;

    const tr = detectLanguage(text) === "tr";
    setShowChips(false);
    setDraft("");
    setMessages((prior) => [...prior, { role: "user", text }]);
    history.current = [...history.current, { role: "user" as const, content: text }].slice(-10);

    /* ---- an intake in progress owns the turn ---- */
    if (intake) {
      if (isDecline(text)) {
        setIntake(null);
        setShowChips(true);
        say(tr ? "Tabii, geçiyorum 🌿 Başka nasıl yardımcı olabilirim?" : "Of course — skipping that 🌿 What else can I help with?");
        return;
      }

      const email = extractEmail(text);
      if (email) {
        captureLead(intake, email, text, tr ? "tr" : "en");
        setIntake(null);
        setShowChips(true);
        say(
          tr
            ? `Teşekkürler 🌿 ${email} adresini ve konuşmayı ekibe ilettim.`
            : `Got it 🌿 I've passed ${email} and this conversation to the team.`,
        );
        return;
      }

      say(
        tr
          ? `Geçerli bir e-posta göremedim 🌿 Yazabilirsen iletirim; istemiyorsan “hayır” de. ${SUPPORT_EMAIL} adresine de yazabilirsin.`
          : `I don't have a valid email yet 🌿 Type it and I'll pass it on, or say "no" to skip. You can also write to ${SUPPORT_EMAIL}.`,
      );
      return;
    }

    /* ---- the table, which costs nothing ---- */
    const local = answerLocally(text);
    if (local) {
      say(tr ? local.tr : local.en);
      if (local.intake) setIntake(local.intake);
      return;
    }

    /* ---- and only now, the model ---- */
    if (overDailyLimit()) {
      say(
        tr
          ? `Bugünlük bu kadar sohbet edebiliyorum 💙 [Mekânlara](/spaces) göz atabilir ya da ${SUPPORT_EMAIL} adresine yazabilirsin.`
          : `That's as much as I can chat today 💙 Have a look at [the spaces](/spaces), or write to ${SUPPORT_EMAIL}.`,
      );
      return;
    }

    countModelCall();
    setBusy(true);

    try {
      const response = await fetch(CHAT_PROXY_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          max_tokens: 180,
          system: JADE_SYSTEM_PROMPT,
          messages: history.current.slice(-6),
        }),
      });

      const data: unknown = await response.json().catch(() => null);
      const reply = readReply(data);

      if (!response.ok || !reply) throw new Error("no reply");
      say(reply);
    } catch {
      say(
        tr
          ? "Şu an küçük bir bağlantı sorunu var 💙 Birazdan tekrar dener misin?"
          : "I'm having a small connection issue 💙 Try again in a moment?",
      );
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  };

  return (
    <>
      {/*
        The bubble disappears while the panel is open.

        It used to stay put and turn into an ×, which left a 56px circle
        floating below its own window — two controls for one thing, and the
        larger of them was the one that only closed it. The close moved into
        the panel's own header, where a close belongs, and this is now only
        ever the way in.
      */}
      <button
        type="button"
        hidden={open}
        onClick={() => {
          setOpen((was) => !was);
          /*
            The greeting belongs to the click rather than to an effect on
            `open`. Setting state from an effect that watches the state it
            sets is a render loop waiting for a second condition to go wrong,
            and there is nothing async here to wait for.
          */
          if (messages.length === 0) {
            setMessages([{ role: "bot", text: JADE_GREETING }]);
          }
        }}
        aria-label="Chat with Jade"
        aria-expanded={open}
        className="fixed bottom-6 right-6 z-[9999] flex h-12 w-12 items-center justify-center rounded-full text-white transition-transform hover:scale-105"
        style={{
          background: "linear-gradient(135deg,#0F2F55,#0EA5E9)",
          boxShadow: "0 4px 18px rgba(15,47,85,.34)",
        }}
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden>
          <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z" />
        </svg>
      </button>

      {open && (
        <div
          /*
            Smaller, and sitting where the bubble was rather than above it.
            370x540 read as a second application opened over the page. This is
            about an eighth off both, which is the difference between a panel
            and a window.
          */
          className="fixed bottom-6 right-6 z-[9998] flex h-[476px] max-h-[calc(100vh-96px)] w-[min(336px,calc(100vw-24px))] flex-col overflow-hidden rounded-[18px] bg-white"
          style={{ boxShadow: "0 8px 40px rgba(15,47,85,.16)" }}
          role="dialog"
          aria-label="Chat with Jade"
        >
          <div
            className="flex shrink-0 items-center gap-3 px-5 py-4"
            style={{ background: "linear-gradient(135deg,#0F2F55,#1a4a7a)" }}
          >
            <span
              className="flex h-9 w-9 items-center justify-center rounded-full text-[18px]"
              style={{ backgroundColor: "rgba(255,255,255,.15)" }}
            >
              💚
            </span>
            <div className="flex-1">
              <p className="text-[15px] text-white" style={{ fontFamily: "var(--font-dm-serif)" }}>
                Jade
              </p>
              {/*
                The company, not the job title. "Front desk" describes what she
                does for us; the name of the place is what tells a visitor
                whose desk they are standing at.
              */}
              <p className="flex items-center gap-1.5 text-[11px] text-white/60">
                <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: "#4ade80" }} />
                Minimum Stress
              </p>
            </div>

            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close chat"
              className="-mr-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[20px] leading-none text-white/70 transition-colors hover:bg-white/10 hover:text-white"
            >
              ×
            </button>
          </div>

          <div ref={scroller} className="flex-1 overflow-y-auto p-4" style={{ backgroundColor: "#f8fafc" }}>
            <div className="flex flex-col gap-3">
              {messages.map((message, index) => (
                <Bubble key={index} message={message} />
              ))}
              {busy && (
                <div className="flex items-end gap-2">
                  <Avatar />
                  <div className="rounded-[4px_16px_16px_16px] bg-white px-4 py-3 shadow-sm">
                    <span className="flex gap-1">
                      {[0, 1, 2].map((dot) => (
                        <span
                          key={dot}
                          className="h-1.5 w-1.5 rounded-full"
                          style={{ backgroundColor: "#94a3b8" }}
                        />
                      ))}
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>

          {showChips && (
            <div className="flex flex-wrap gap-1.5 px-4 py-2" style={{ backgroundColor: "#f8fafc" }}>
              {QUICK_REPLIES.map((chip) => (
                <button
                  key={chip}
                  type="button"
                  onClick={() => void send(chip)}
                  className="rounded-full bg-white px-3 py-1.5 text-[12px] font-medium transition-colors"
                  style={{ border: "1.5px solid #e2e8f0", color: "#0F2F55" }}
                >
                  {chip}
                </button>
              ))}
            </div>
          )}

          <form
            onSubmit={(event) => {
              event.preventDefault();
              void send(draft);
            }}
            className="flex shrink-0 items-center gap-2 border-t bg-white px-4 py-3"
            style={{ borderColor: "#e2e8f0" }}
          >
            <input
              ref={inputRef}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              disabled={busy}
              placeholder="Ask Jade anything…"
              aria-label="Message"
              className="flex-1 rounded-full px-4 py-2.5 text-[13px] outline-none disabled:opacity-70"
              style={{ border: "1.5px solid #e2e8f0", backgroundColor: "#f8fafc", color: "#1a1a2e" }}
            />
            <button
              type="submit"
              disabled={busy || !draft.trim()}
              aria-label="Send"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-transform hover:scale-105 disabled:opacity-50 disabled:hover:scale-100"
              style={{ background: "linear-gradient(135deg,#0F2F55,#0EA5E9)" }}
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="#fff" aria-hidden>
                <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
              </svg>
            </button>
          </form>
        </div>
      )}
    </>
  );
}

function Avatar() {
  return (
    <span
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[13px]"
      style={{ background: "linear-gradient(135deg,#0F2F55,#0EA5E9)" }}
    >
      💚
    </span>
  );
}

function Bubble({ message }: { message: Message }) {
  if (message.role === "user") {
    return (
      <div className="flex flex-row-reverse items-end gap-2">
        <p
          className="max-w-[80%] rounded-[16px_16px_4px_16px] px-3.5 py-2.5 text-[13.5px] leading-relaxed text-white"
          style={{ background: "linear-gradient(135deg,#0F2F55,#1a4a7a)" }}
        >
          {message.text}
        </p>
      </div>
    );
  }

  return (
    <div className="flex items-end gap-2">
      <Avatar />
      <p
        className="max-w-[80%] rounded-[4px_16px_16px_16px] bg-white px-3.5 py-2.5 text-[13.5px] leading-relaxed shadow-sm"
        style={{ color: "#1a1a2e" }}
      >
        {renderMarkdown(message.text)}
      </p>
    </div>
  );
}

/**
 * Links and bold, and nothing else.
 *
 * The widget this replaces built HTML with a string of `.replace()` calls and
 * handed it to `innerHTML` — which is fine right up until a model, or a lead
 * echoed back into the transcript, contains a tag. This walks the text and
 * returns React nodes, so there is no HTML to inject into.
 */
function renderMarkdown(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const pattern = /\[([^\]]+)\]\(([^)]+)\)|\*\*([^*]+)\*\*/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) nodes.push(text.slice(last, match.index));

    if (match[1] && match[2]) {
      // Internal paths only. A model that hallucinates an external link
      // should produce text, not something somebody can click.
      const href = match[2].startsWith("/") ? match[2] : null;
      nodes.push(
        href ? (
          <a
            key={key++}
            href={href}
            className="font-bold underline"
            style={{ color: "#0EA5E9" }}
          >
            {match[1]}
          </a>
        ) : (
          <span key={key++}>{match[1]}</span>
        ),
      );
    } else if (match[3]) {
      nodes.push(
        <strong key={key++} style={{ color: "#0F2F55" }}>
          {match[3]}
        </strong>,
      );
    }

    last = pattern.lastIndex;
  }

  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

/** The proxy has returned several shapes over its life. Read them all. */
function readReply(data: unknown): string {
  if (!data || typeof data !== "object") return "";
  const shape = data as Record<string, unknown>;

  for (const key of ["reply", "message", "text", "response", "completion", "result"]) {
    if (typeof shape[key] === "string" && shape[key]) return shape[key] as string;
  }

  const content = shape.content;
  if (Array.isArray(content) && content[0] && typeof content[0] === "object") {
    const first = content[0] as Record<string, unknown>;
    if (typeof first.text === "string") return first.text;
  }

  return "";
}
