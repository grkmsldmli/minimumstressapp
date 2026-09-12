"use client";

import { Archive, CopyPlus, Eye, Pause, X } from "lucide-react";
import { useEffect, useState } from "react";

import { errorMessage } from "@/lib/error-message";
import {
  LISTING_CLOSURE_REASONS,
  listingClosureReasonLabel,
  type ListingClosureReason,
  type ListingClosureRequest,
} from "@/lib/listing-closure";

interface ListingVisibilitySheetProps {
  open: boolean;
  spaceName: string;
  hidden: boolean;
  archived?: boolean;
  upcoming: number;
  closureRequest?: ListingClosureRequest | null;
  onClose: () => void;
  onHide: () => Promise<unknown>;
  onReplace: () => Promise<unknown>;
  onShowAgain: () => Promise<unknown>;
  onRequestClosure: (reason: ListingClosureReason, detail: string) => Promise<unknown>;
}

export function ListingVisibilitySheet(props: ListingVisibilitySheetProps) {
  return props.open ? <ListingVisibilityDialog {...props} /> : null;
}

function ListingVisibilityDialog({
  spaceName,
  hidden,
  archived = false,
  upcoming,
  closureRequest,
  onClose,
  onHide,
  onReplace,
  onShowAgain,
  onRequestClosure,
}: ListingVisibilitySheetProps) {
  const [step, setStep] = useState<"choices" | "permanent">("choices");
  const [reason, setReason] = useState<ListingClosureReason | null>(null);
  const [detail, setDetail] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [onClose]);

  const run = async (key: string, action: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(key);
    setError(null);
    try {
      await action();
      onClose();
    } catch (cause) {
      setError(errorMessage(cause, "That did not change."));
      setBusy(null);
    }
  };

  const otherNeedsDetail = reason === "other" && detail.trim().length < 3;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center"
      style={{ backgroundColor: "rgba(10,27,45,0.46)" }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="listing-visibility-title"
        className="w-full max-w-[540px] rounded-t-[28px] bg-white px-6 pt-5 pb-7 safe-pb-7 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="font-body text-[11px] uppercase tracking-[0.18em] text-ink-faint">
              {spaceName}
            </p>
            <h2
              id="listing-visibility-title"
              className="font-display italic font-semibold text-[23px] text-navy mt-1"
            >
              {archived
                ? "Permanently closed."
                : closureRequest
                ? "Closure request sent."
                : hidden
                  ? "Bring this listing back?"
                  : step === "permanent"
                    ? "Close permanently."
                    : "What would you like to do?"}
            </h2>
          </div>
          <button
            type="button"
            aria-label="Close"
            disabled={Boolean(busy)}
            onClick={onClose}
            className="w-9 h-9 rounded-full flex items-center justify-center press disabled:opacity-40"
            style={{ backgroundColor: "#F1F5F8" }}
          >
            <X size={17} color="#516174" />
          </button>
        </div>

        {archived ? (
          <div className="mt-5 rounded-2xl p-4" style={{ backgroundColor: "#F1F3F6" }}>
            <p className="font-body font-semibold text-[14px] text-navy">Archived by Minimum Stress</p>
            <p className="font-body text-[13px] leading-relaxed text-ink-soft mt-1">
              This listing is permanently closed. Its booking, payment and audit history are preserved.
            </p>
          </div>
        ) : closureRequest ? (
          <div className="mt-5 rounded-2xl p-4" style={{ backgroundColor: "#FFF8F1" }}>
            <p className="font-body font-semibold text-[14px] text-navy">Waiting for review</p>
            <p className="font-body text-[13px] leading-relaxed text-ink-soft mt-1">
              The listing is hidden. Minimum Stress will review the permanent closure request;
              your existing bookings and payment history stay unchanged.
            </p>
            <p className="font-body text-[12px] text-ink-faint mt-3">
              Reason · {listingClosureReasonLabel(closureRequest.reason)}
            </p>
            {closureRequest.detail && (
              <p className="font-body text-[12px] text-ink-soft mt-1">{closureRequest.detail}</p>
            )}
          </div>
        ) : hidden ? (
          <div className="mt-5">
            <p className="font-body text-[13.5px] leading-relaxed text-ink-soft">
              It will go back to review before becoming bookable again.
            </p>
            <button
              type="button"
              disabled={Boolean(busy)}
              onClick={() => void run("show", onShowAgain)}
              className="w-full mt-5 py-3.5 rounded-xl font-body font-semibold text-[14px] text-white press disabled:opacity-50 flex items-center justify-center gap-2 bg-sky"
            >
              <Eye size={16} /> {busy === "show" ? "Sending…" : "Send back for review"}
            </button>
          </div>
        ) : step === "choices" ? (
          <div className="mt-5 flex flex-col gap-2.5">
            <Choice
              icon={Pause}
              title="Hide for now"
              body="Remove it from search now. You can submit it for review again later."
              disabled={Boolean(busy)}
              onClick={() => void run("hide", onHide)}
            />
            <Choice
              icon={CopyPlus}
              title="I’m replacing this listing"
              body="Keep this one hidden and start a new listing. Its history stays here."
              disabled={Boolean(busy)}
              onClick={() => void run("replace", onReplace)}
            />
            <Choice
              icon={Archive}
              title="Close this space permanently"
              body="Hide it now and send a closure request to Minimum Stress for approval."
              danger
              disabled={Boolean(busy)}
              onClick={() => setStep("permanent")}
            />
          </div>
        ) : (
          <div className="mt-5">
            <p className="font-body text-[13px] leading-relaxed text-ink-soft">
              Choose why this space is closing. The listing is hidden immediately, but only
              Minimum Stress can archive it permanently.
            </p>

            <div className="flex flex-col gap-2 mt-4">
              {LISTING_CLOSURE_REASONS.map((item) => (
                <label
                  key={item.value}
                  className="flex items-center gap-3 rounded-xl px-3.5 py-3 cursor-pointer"
                  style={{ border: `1px solid ${reason === item.value ? "#7EBCEB" : "#E4ECF3"}` }}
                >
                  <input
                    type="radio"
                    name="closure-reason"
                    value={item.value}
                    checked={reason === item.value}
                    onChange={() => setReason(item.value)}
                    className="accent-sky"
                  />
                  <span className="font-body text-[13px] text-navy">{item.label}</span>
                </label>
              ))}
            </div>

            <label className="block mt-4">
              <span className="font-body text-[12px] font-semibold text-navy">
                Details {reason === "other" ? "(required)" : "(optional)"}
              </span>
              <textarea
                value={detail}
                onChange={(event) => setDetail(event.target.value.slice(0, 1000))}
                rows={3}
                placeholder="Anything we should know before approving the closure?"
                className="w-full mt-2 rounded-xl px-3.5 py-3 font-body text-[13px] outline-none resize-none text-navy"
                style={{ border: "1px solid #DCE7F0" }}
              />
            </label>

            {upcoming > 0 && (
              <p className="font-body text-[12px] leading-relaxed mt-3 text-ink-soft">
                {upcoming === 1 ? "One existing booking stays" : `${upcoming} existing bookings stay`} on
                the calendar. Closing the listing does not cancel or refund them.
              </p>
            )}

            <div className="flex gap-2.5 mt-5">
              <button
                type="button"
                disabled={Boolean(busy)}
                onClick={() => setStep("choices")}
                className="flex-1 py-3.5 rounded-xl font-body font-semibold text-[14px] text-ink-soft press disabled:opacity-50"
                style={{ border: "1px solid #DCE7F0" }}
              >
                Back
              </button>
              <button
                type="button"
                disabled={!reason || otherNeedsDetail || Boolean(busy)}
                onClick={() =>
                  reason && void run("permanent", () => onRequestClosure(reason, detail.trim()))
                }
                className="flex-[1.7] py-3.5 rounded-xl font-body font-semibold text-[14px] text-white press disabled:opacity-40 bg-coral-deep"
              >
                {busy === "permanent" ? "Sending request…" : "Confirm closure request"}
              </button>
            </div>
          </div>
        )}

        {error && (
          <p className="font-body text-[12.5px] text-coral-deep mt-4" role="alert">
            {error}
          </p>
        )}
      </section>
    </div>
  );
}

function Choice({
  icon: Icon,
  title,
  body,
  danger = false,
  disabled,
  onClick,
}: {
  icon: typeof Pause;
  title: string;
  body: string;
  danger?: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="w-full rounded-2xl p-4 text-left press disabled:opacity-50 flex items-start gap-3"
      style={{ border: `1px solid ${danger ? "#F2C8C3" : "#E1EAF2"}` }}
    >
      <span
        className="w-9 h-9 rounded-full flex items-center justify-center shrink-0"
        style={{ backgroundColor: danger ? "#FFF1EF" : "#EDF6FE" }}
      >
        <Icon size={16} color={danger ? "#B64A42" : "#2578C2"} />
      </span>
      <span>
        <span className="block font-body font-semibold text-[14px] text-navy">{title}</span>
        <span className="block font-body text-[12.5px] leading-relaxed text-ink-soft mt-0.5">
          {body}
        </span>
      </span>
    </button>
  );
}
