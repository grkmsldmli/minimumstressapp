"use client";

import { useState } from "react";
import { Check, Clock, Users, X } from "lucide-react";

import { MAX_DECLINE_NOTE, minutesLeft } from "@/lib/booking-approval";
import { bookingUse } from "@/lib/booking-use";
import type { BookingRequest } from "@/lib/domain";
import { errorMessage } from "@/lib/error-message";
import { formatCents } from "@/lib/money";
import { sessionDate, sessionTime } from "@/lib/when";

/**
 * What is waiting on the host.
 *
 * Sits above the calendar rather than behind a tab, because a request that is
 * not seen is a request that expires — and an expired one costs the host the
 * booking and the guest the wait. A queue nobody notices is the same as no
 * queue.
 *
 * Every request carries what it is for and how many people are coming, on the
 * card itself. That is the whole reason a host was asked to answer: sending
 * them elsewhere to find out would leave them approving on the hour alone,
 * which is what instant booking already did.
 */
export function RequestQueue({
  requests,
  zoneOf,
  onAnswer,
}: {
  requests: BookingRequest[];
  /** The room's own clock, so an hour is written the way the host set it. */
  zoneOf: (spaceId: string) => string;
  onAnswer: (
    bookingId: string,
    decision: "approve" | "decline",
    note?: string,
  ) => Promise<void>;
}) {
  if (requests.length === 0) return null;

  return (
    <div className="mb-6">
      <p className="font-body font-semibold text-[12px] uppercase tracking-[0.2em] mb-2.5 text-sky-text">
        Waiting on you · {requests.length}
      </p>
      <div className="flex flex-col gap-2.5">
        {requests.map((request) => (
          <RequestCard
            key={request.id}
            request={request}
            zone={zoneOf(request.spaceId)}
            onAnswer={onAnswer}
          />
        ))}
      </div>
    </div>
  );
}

function RequestCard({
  request,
  zone,
  onAnswer,
}: {
  request: BookingRequest;
  zone: string;
  onAnswer: (
    bookingId: string,
    decision: "approve" | "decline",
    note?: string,
  ) => Promise<void>;
}) {
  const [busy, setBusy] = useState<"approve" | "decline" | null>(null);
  const [declining, setDeclining] = useState(false);
  const [note, setNote] = useState("");
  const [failed, setFailed] = useState<string | null>(null);

  const answer = (decision: "approve" | "decline") => {
    if (busy) return;
    setFailed(null);
    setBusy(decision);
    void onAnswer(request.id, decision, decision === "decline" ? note.trim() : undefined)
      .catch((cause) => {
        setFailed(errorMessage(cause, "That did not go through. Try again in a moment."));
        setBusy(null);
      });
  };

  const use = request.purpose ? bookingUse(request.purpose) : null;
  const left = minutesLeft(
    { approvalState: "pending", requestedAt: request.requestedAt, startsAt: request.startsAt },
    new Date(),
  );

  return (
    <div
      className="rounded-2xl p-4 bg-white"
      style={{ border: "1px solid #D6E6F5", boxShadow: "0 10px 26px -18px rgba(22,48,78,0.35)" }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-body font-medium text-[15.5px] text-navy truncate">
            {request.practitionerName}
          </p>
          <p className="font-body font-normal text-[14px] mt-0.5 text-ink-soft">
            {sessionDate(request.startsAt, zone)} · {sessionTime(request.startsAt, zone)}
          </p>
        </div>
        <p className="font-display italic font-semibold text-[19px] shrink-0 text-navy">
          {formatCents(request.netCents)}
        </p>
      </div>

      {/*
        What they said they would be doing. "Something else" shows their own
        words instead of the word "other", because the note is the thing the
        host is actually deciding on.
      */}
      {use && (
        <p className="font-body font-normal text-[14.5px] leading-relaxed mt-2.5 text-navy">
          {use.key === "other" && request.purposeNote ? request.purposeNote : use.label}
        </p>
      )}

      <div className="flex items-center gap-4 mt-2">
        {request.attendeeCount !== null && (
          <span className="flex items-center gap-1.5 font-body text-[14px] text-ink-soft">
            <Users size={14} />
            {request.attendeeCount} {request.attendeeCount === 1 ? "person" : "people"}
          </span>
        )}
        {/*
          The deadline, said as time remaining rather than as a timestamp. A
          host reading "expires at 4:12pm tomorrow" has to do the arithmetic;
          the only thing they want to know is whether this is urgent.
        */}
        <span className="flex items-center gap-1.5 font-body text-[14px] text-ink-soft">
          <Clock size={14} />
          {describeLeft(left)}
        </span>
      </div>

      {failed && (
        <p className="font-body font-normal text-[14px] leading-relaxed mt-2.5 text-[#C0453A]">
          {failed}
        </p>
      )}

      {declining ? (
        <div className="mt-3">
          <label
            htmlFor={`note-${request.id}`}
            className="font-body font-normal text-[14px] text-ink-soft"
          >
            Anything you want to tell them? Optional.
          </label>
          <textarea
            id={`note-${request.id}`}
            value={note}
            maxLength={MAX_DECLINE_NOTE}
            onChange={(event) => setNote(event.target.value)}
            rows={2}
            className="w-full mt-1.5 p-3 rounded-xl font-body text-[15px] text-navy"
            style={{ border: "1px solid #DCE7F2" }}
            placeholder="I have a class in there straight after"
          />
          <div className="flex gap-2 mt-2">
            <button
              type="button"
              onClick={() => answer("decline")}
              disabled={busy !== null}
              className="flex-1 py-2.5 rounded-xl font-body font-medium text-[15px] text-white press"
              style={{ backgroundColor: "#C0453A", opacity: busy ? 0.6 : 1 }}
            >
              {busy === "decline" ? "Declining…" : "Decline"}
            </button>
            <button
              type="button"
              onClick={() => setDeclining(false)}
              disabled={busy !== null}
              className="px-4 py-2.5 rounded-xl font-body font-medium text-[15px] press text-sky-text"
              style={{ border: "1px solid #DCE7F2" }}
            >
              Back
            </button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2 mt-3">
          <button
            type="button"
            onClick={() => answer("approve")}
            disabled={busy !== null}
            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl font-body font-medium text-[15px] text-white press"
            style={{ backgroundColor: "#2578C2", opacity: busy ? 0.6 : 1 }}
          >
            <Check size={15} />
            {busy === "approve" ? "Approving…" : "Approve"}
          </button>
          <button
            type="button"
            onClick={() => setDeclining(true)}
            disabled={busy !== null}
            className="flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl font-body font-medium text-[15px] press text-sky-text"
            style={{ border: "1px solid #DCE7F2" }}
          >
            <X size={15} />
            Decline
          </button>
        </div>
      )}

      {/*
        Said on every card, because it is the fact that makes declining easy.
        A host who thinks approving is the polite option, or that refusing
        takes money off somebody, answers differently from one who knows the
        card is only held.
      */}
      <p className="font-body font-normal text-[13.5px] leading-relaxed mt-2.5 text-ink-faint">
        Their card is held, not charged. Declining costs you nothing and takes nothing from them.
      </p>
    </div>
  );
}

/** "3 hours left", and the last hour by the minute because it is the urgent one. */
function describeLeft(minutes: number): string {
  if (minutes <= 0) return "Expiring now";
  if (minutes < 60) return `${minutes} min left`;
  const hours = Math.round(minutes / 60);
  return `${hours} hour${hours === 1 ? "" : "s"} left`;
}
