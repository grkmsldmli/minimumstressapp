"use client";

import { AlertTriangle, CheckCircle2, Clock } from "lucide-react";

import type { DocumentReview } from "@/lib/domain";

/**
 * What happened to a file the host handed over.
 *
 * A host gives us their lease — the document that proves they may sublet at
 * all — and then the app goes quiet. "Pending" on the listing covered three
 * different answers: nobody has looked, somebody looked and it was fine,
 * somebody looked and it was unreadable. There was no way to tell which, and
 * no way to find out except waiting to see whether the listing went live.
 *
 * That is the wrong side of the asymmetry. We are holding their paperwork;
 * they should not be the one guessing.
 */
export function DocumentStatus({
  label,
  fileName,
  review,
  note,
  optional = false,
}: {
  label: string;
  fileName: string | null;
  review: DocumentReview;
  /** Staff's own words, shown as written, on a rejection. */
  note?: string | null;
  optional?: boolean;
}) {
  if (!fileName) {
    return optional ? (
      <Row
        tone="idle"
        icon={<Clock size={14} color="#566D85" />}
        title={label}
        detail="Not added"
      />
    ) : null;
  }

  const when = review.reviewedAt
    ? review.reviewedAt.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : null;

  if (review.state === "verified") {
    return (
      <Row
        tone="good"
        icon={<CheckCircle2 size={14} color="#557255" />}
        title={label}
        detail={when ? `Verified ${when}` : "Verified"}
        file={fileName}
      />
    );
  }

  if (review.state === "rejected") {
    return (
      <Row
        tone="bad"
        icon={<AlertTriangle size={14} color="#B45143" />}
        title={label}
        // The reason, in the reviewer's words. A rejection with nothing
        // attached leaves a host re-uploading the same file.
        detail={note || (when ? `Not accepted ${when}` : "Not accepted")}
        file={fileName}
      />
    );
  }

  return (
    <Row
      tone="idle"
      icon={<Clock size={14} color="#566D85" />}
      title={label}
      detail="Waiting on us"
      file={fileName}
    />
  );
}

/**
 * The last segment, and only that.
 *
 * The column holds a storage path — owner id, listing id, a generated name —
 * and printing it whole showed a host three UUIDs and told them nothing about
 * which file this was. The stored name is generated anyway, so the extension
 * is the only part that carries meaning; the label above it says the rest.
 */
function shortName(path: string): string {
  const tail = path.split("/").pop() ?? path;
  const dot = tail.lastIndexOf(".");
  return dot > 0 ? `Uploaded ${tail.slice(dot + 1).toUpperCase()}` : "Uploaded file";
}

function Row({
  tone,
  icon,
  title,
  detail,
  file,
}: {
  tone: "good" | "bad" | "idle";
  icon: React.ReactNode;
  title: string;
  detail: string;
  file?: string;
}) {
  const skin =
    tone === "good"
      ? { backgroundColor: "#EFF4EC", border: "1px solid #DCE6D6" }
      : tone === "bad"
        ? { backgroundColor: "#FEF2F0", border: "1px solid #F5C4BC" }
        : { backgroundColor: "#F4F8FC", border: "1px solid #E7EEF6" };

  return (
    <div className="rounded-xl px-3.5 py-3 flex items-start gap-2.5" style={skin}>
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div className="min-w-0">
        <p className="font-body font-medium text-[14px] text-navy">{title}</p>
        <p className="font-body font-normal text-[13.5px] mt-0.5 leading-relaxed text-ink-soft">
          {detail}
        </p>
        {file && (
          <p className="font-body font-normal text-[12px] mt-0.5 truncate text-ink-faint">
            {shortName(file)}
          </p>
        )}
      </div>
    </div>
  );
}
