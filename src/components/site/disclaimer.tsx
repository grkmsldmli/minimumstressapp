/**
 * The medical disclaimer, folded into a button.
 *
 * It used to be a grey box the width of the page under every assessment —
 * important, and shouted. Important is the reason to keep it; shouted is the
 * reason nobody read it. So it is a small pill now: closed by default, open on
 * a tap, closed again on the next.
 *
 * `<details>` rather than a state hook, for the reasons that keep recurring on
 * this site: it works with JavaScript off, a crawler and find-in-page both
 * read the text whether it is open or shut, and there is no open/closed state
 * that can disagree with what is on screen. The disclaimer has to be *present*
 * for a reader who goes looking — a collapsible that hid it from a machine
 * would defeat the point of having it.
 *
 * One component, used on every assessment and on the hub, so the wording is in
 * one place and cannot drift between pages. The default text is the hub's; a
 * page with its own (burnout talks about mental health, the calculators about
 * measurement) passes `children`.
 */
export function Disclaimer({
  children,
  className = "",
}: {
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <details
      className={`group mt-12 ${className}`}
      style={{ color: "#5f6673" }}
    >
      <summary
        className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-colors"
        style={{ backgroundColor: "#f8fbfd", border: "1px solid #e7eef6", color: "#5f6673" }}
      >
        <InfoGlyph />
        Disclaimer
        <span
          aria-hidden
          className="text-[11px] transition-transform duration-200 group-open:rotate-180"
          style={{ color: "#8a94a3" }}
        >
          ▾
        </span>
      </summary>
      <p
        className="mt-2.5 max-w-2xl rounded-2xl p-5 text-[14px] leading-[1.75]"
        style={{ backgroundColor: "#f8fbfd", border: "1px solid #e7eef6" }}
      >
        {children ?? (
          <>
            These assessments are for information, not medical advice. They score self-reported
            answers and are not clinical measurements — nothing here diagnoses, treats, or rules
            anything out. Minimum Stress is not a medical provider. If something worries you, see a
            doctor.
          </>
        )}
      </p>
    </details>
  );
}

/** A small circled ‘i’, inline, so the button reads as information at a glance. */
function InfoGlyph() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="12" cy="12" r="9.5" />
      <path d="M12 11v5" />
      <path d="M12 7.75h.01" />
    </svg>
  );
}
