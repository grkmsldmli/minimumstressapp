"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";

import { SUPPORT_EMAIL } from "@/lib/company";
import {
  JADE_AVATAR,
  JADE_GREETING,
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
  /** Characters revealed so far. Absent means all of it — user messages. */
  revealed?: number;
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

  const [nudge, setNudge] = useState(false);
  /** The dots. Shown while she is thinking as well as while the model is. */
  const [typing, setTyping] = useState(false);
  /** Where the next bot message will land, so its reveal can be addressed. */
  const messagesRef = useRef(0);
  const reducedMotion = useRef(false);

  useEffect(() => {
    messagesRef.current = messages.length;
  }, [messages]);

  /*
   * Somebody who has asked for less motion gets the whole sentence at once.
   * Read from the ref rather than state so `say` sees it without being
   * rebuilt, and read once because it is a preference, not an event.
   */
  useEffect(() => {
    reducedMotion.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }, []);

  useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight;
  }, [messages, busy, typing]);

  /*
   * A single nudge at eight seconds, for somebody who has not opened it.
   *
   * Long enough that they have read something and may have a question, short
   * enough to still be on the page. It runs three times and stops — a bubble
   * that pulses forever is an advertisement, and the one that pulses when you
   * are already typing in it is worse.
   */
  useEffect(() => {
    if (open) return;
    const timer = setTimeout(() => setNudge(true), 8000);
    return () => clearTimeout(timer);
  }, [open]);

  /*
   * Every timer this component starts, so none of them outlive it.
   *
   * A visitor who closes the tab mid-sentence leaves a chain of setTimeouts
   * calling setState on something React has thrown away.
   */
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const wait = (ms: number) =>
    new Promise<void>((resolve) => {
      timers.current.push(setTimeout(resolve, ms));
    });

  /**
   * Jade answering: a pause, then the sentence arriving a character at a time.
   *
   * The typing is not decoration. The routing table answers in zero
   * milliseconds and the model in a second or two, and without this the
   * difference is obvious to anybody — one reply materialises whole, the other
   * arrives after a wait. Typing both makes the cheap path indistinguishable
   * from the expensive one, which is the entire point of having it.
   */
  const say = async (text: string) => {
    history.current = [...history.current, { role: "assistant" as const, content: text }].slice(-10);

    if (reducedMotion.current) {
      setMessages((prior) => [...prior, { role: "bot", text }]);
      return;
    }

    setTyping(true);
    await wait(thinkingPause(text));
    setTyping(false);

    const total = visibleLength(text);
    const index = messagesRef.current;
    setMessages((prior) => [...prior, { role: "bot", text, revealed: 0 }]);

    // Fast enough that a long answer never outstays its welcome.
    const perChar = Math.min(TYPE_MS_PER_CHAR, TYPE_MAX_MS / Math.max(total, 1));

    for (let shown = 1; shown <= total; shown++) {
      await wait(restAfter(text.charAt(shown - 1), perChar));
      setMessages((prior) =>
        prior.map((message, at) => (at === index ? { ...message, revealed: shown } : message)),
      );
    }
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
    void fetch("/api/jade/lead", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type,
        email,
        message: note,
        conversation: history.current
          .slice(-10)
          .map((m) => `${m.role === "assistant" ? "Luna" : "User"}: ${m.content}`)
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
        void say(tr ? "Tabii, geçiyorum 🌿 Başka nasıl yardımcı olabilirim?" : "Of course — skipping that 🌿 What else can I help with?");
        return;
      }

      const email = extractEmail(text);
      if (email) {
        captureLead(intake, email, text, tr ? "tr" : "en");
        setIntake(null);
        setShowChips(true);
        void say(
          tr
            ? `Teşekkürler 🌿 ${email} adresini ve konuşmayı ekibe ilettim.`
            : `Got it 🌿 I've passed ${email} and this conversation to the team.`,
        );
        return;
      }

      void say(
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
      void say(
        tr
          ? `Bugünlük bu kadar sohbet edebiliyorum 💙 [Mekânlara](/spaces) göz atabilir ya da ${SUPPORT_EMAIL} adresine yazabilirsin.`
          : `That's as much as I can chat today 💙 Have a look at [the spaces](/spaces), or write to ${SUPPORT_EMAIL}.`,
      );
      return;
    }

    countModelCall();
    setBusy(true);

    try {
      /*
        Our own route, not the proxy.

        The proxy allows one origin and refuses every other hostname the site
        is served from — staging, www, localhost — with a 403 the visitor sees
        as a connection error. A same-origin request cannot be refused for its
        origin, and the server call behind it sends none at all.
      */
      const response = await fetch("/api/jade/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history.current.slice(-6) }),
      });

      const data: unknown = await response.json().catch(() => null);
      const reply = readReply(data);

      if (!response.ok || !reply) {
        /*
         * Named in the console, because the two failures look identical from
         * the outside and lead to completely different places.
         *
         * The proxy keeps an allowlist of origins. A site served from any
         * hostname it does not know — a staging subdomain, www — gets a 403,
         * and the visitor sees "connection issue" while the network is fine.
         * Anybody debugging that from the message alone looks at the wrong
         * thing for an hour.
         */
        console.error(`Jade: /api/jade/chat returned ${response.status}`);
        throw new Error("no reply");
      }
      await say(reply);
    } catch {
      void say(
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
          setNudge(false);
          setOpen((was) => !was);
          /*
            The greeting belongs to the click rather than to an effect on
            `open`. Setting state from an effect that watches the state it
            sets is a render loop waiting for a second condition to go wrong,
            and there is nothing async here to wait for.
          */
          /*
            The greeting types too.

            It was set straight into state, so the panel opened with a
            finished paragraph already sitting in it — the one message a
            visitor is guaranteed to see, and the one that set the
            expectation that this thing answers before it is asked.
          */
          if (messages.length === 0) void say(JADE_GREETING);
        }}
        aria-label="Chat with Luna"
        aria-expanded={open}
        className={`fixed bottom-6 right-6 z-[9999] flex h-12 w-12 items-center justify-center rounded-full text-white transition-transform hover:scale-105 active:scale-95 ${nudge && !open ? "jade-nudge" : ""}`}
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
          className="jade-panel fixed bottom-6 right-6 z-[9998] flex h-[476px] max-h-[calc(100vh-96px)] w-[min(336px,calc(100vw-24px))] flex-col overflow-hidden rounded-[18px] bg-white"
          style={{ boxShadow: "0 8px 40px rgba(15,47,85,.16)" }}
          role="dialog"
          aria-label="Chat with Luna"
        >
          <div
            className="flex shrink-0 items-center gap-3 px-5 py-4"
            style={{ background: "linear-gradient(135deg,#0F2F55,#1a4a7a)" }}
          >
            <Image
              src={JADE_AVATAR}
              alt=""
              width={72}
              height={72}
              className="h-9 w-9 shrink-0 rounded-full object-cover"
              style={{ border: "1.5px solid rgba(255,255,255,.25)" }}
            />
            <div className="flex-1">
              <p className="text-[15px] text-white" style={{ fontFamily: "var(--font-dm-serif)" }}>
                Luna
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
              {(busy || typing) && (
                <div className="jade-message flex items-end gap-2">
                  <Avatar />
                  <div className="rounded-[4px_16px_16px_16px] bg-white px-4 py-3 shadow-sm">
                    <span className="flex gap-1" role="status" aria-label="Luna is typing">
                      {[0, 1, 2].map((dot) => (
                        <span
                          key={dot}
                          className="jade-dot h-1.5 w-1.5 rounded-full"
                          style={{
                            backgroundColor: "#94a3b8",
                            // Staggered, so it reads as a wave rather than a blink.
                            animationDelay: `${dot * 0.2}s`,
                          }}
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
                  className="rounded-full bg-white px-3 py-1.5 text-[12px] font-medium transition-all hover:border-sky-400 hover:text-sky-600 active:scale-95"
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
              placeholder="Ask Luna anything…"
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

/**
 * Decorative, so the alt is empty on purpose.
 *
 * It sits beside every message she sends, and a screen reader announcing
 * "Jade" before each one would read the same word a dozen times down a
 * transcript that already attributes them.
 */
function Avatar() {
  return (
    <Image
      src={JADE_AVATAR}
      alt=""
      width={56}
      height={56}
      className="h-7 w-7 shrink-0 rounded-full object-cover"
    />
  );
}

function Bubble({ message }: { message: Message }) {
  if (message.role === "user") {
    return (
      <div className="jade-message flex flex-row-reverse items-end gap-2">
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
    <div className="jade-message flex items-end gap-2">
      <Avatar />
      <p
        className="max-w-[80%] rounded-[4px_16px_16px_16px] bg-white px-3.5 py-2.5 text-[13.5px] leading-relaxed shadow-sm"
        style={{ color: "#1a1a2e" }}
      >
        {renderTokens(message.text, message.revealed ?? message.text.length)}
      </p>
    </div>
  );
}

/**
 * Links and bold, and nothing else — as tokens, so a message can be half told.
 *
 * Parsed rather than string-replaced. The widget this came from built HTML
 * with a chain of `.replace()` calls and handed it to `innerHTML`, which is
 * fine right up until a model, or a lead echoed back into the transcript,
 * contains a tag.
 *
 * Tokens rather than nodes because the text is revealed a character at a time.
 * Rendering markdown over a truncated string would show `[Find a space](/spa`
 * for a few frames on every link she sends; counting characters across tokens
 * shows the label appearing inside a finished link instead.
 */
interface Token {
  kind: "text" | "link" | "bold";
  text: string;
  href?: string;
}

export function tokenise(text: string): Token[] {
  const tokens: Token[] = [];
  const pattern = /\[([^\]]+)\]\(([^)]+)\)|\*\*([^*]+)\*\*/g;
  let last = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) tokens.push({ kind: "text", text: text.slice(last, match.index) });

    if (match[1] && match[2]) {
      // Internal paths only. A model that hallucinates an external link
      // should produce text, not something somebody can click.
      const href = match[2].startsWith("/") ? match[2] : undefined;
      tokens.push({ kind: href ? "link" : "text", text: match[1], href });
    } else if (match[3]) {
      tokens.push({ kind: "bold", text: match[3] });
    }

    last = pattern.lastIndex;
  }

  if (last < text.length) tokens.push({ kind: "text", text: text.slice(last) });
  return tokens;
}

/** How many characters a reader has to get through. Drives the typing clock. */
export function visibleLength(text: string): number {
  return tokenise(text).reduce((total, token) => total + token.text.length, 0);
}

function renderTokens(text: string, revealed: number): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let budget = revealed;
  let key = 0;

  for (const token of tokenise(text)) {
    if (budget <= 0) break;
    const slice = token.text.slice(0, budget);
    budget -= slice.length;

    if (token.kind === "link" && token.href) {
      nodes.push(
        <a key={key++} href={token.href} className="font-bold underline" style={{ color: "#0EA5E9" }}>
          {slice}
        </a>,
      );
    } else if (token.kind === "bold") {
      nodes.push(
        <strong key={key++} style={{ color: "#0F2F55" }}>
          {slice}
        </strong>,
      );
    } else {
      nodes.push(slice);
    }
  }

  return nodes;
}

/**
 * How fast Jade types, and how long she waits before starting.
 *
 * Instant is not neutral. A reply that lands complete in the same frame as the
 * question reads as a lookup, which is what the routing table is — and the
 * whole point of the table is that the visitor should not be able to tell.
 *
 * The pause before is short and scales a little with length, on the reasoning
 * that a longer answer took longer to think of. The typing itself is a
 * per-character clock with a rest at punctuation, which is what makes it read
 * as writing rather than as a progress bar. It is capped: a long answer speeds
 * up so nobody waits four seconds to read something they have already read.
 */
export const TYPE_MS_PER_CHAR = 11;
export const TYPE_MAX_MS = 2200;

export function thinkingPause(text: string): number {
  return Math.min(700, 260 + visibleLength(text) * 2);
}

export function restAfter(character: string, base: number): number {
  if (".!?".includes(character)) return base + 110;
  if (",;:".includes(character)) return base + 45;
  if (character === "\n") return base + 80;
  return base;
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
