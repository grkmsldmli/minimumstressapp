"use client";

import { useRef, useState } from "react";
import { ImagePlus, Star, X } from "lucide-react";

import type { SpaceMedia } from "@/lib/domain";
import { MAX_BYTES, rejectionReason } from "@/lib/uploads";

/**
 * The photos on a listing, after it exists.
 *
 * Media could only be attached while a listing was being created. A host who
 * uploaded a badly lit photo, or wanted to add the one they took later, had
 * no way to change it — the only route was to delist and start again, which
 * throws away the reviews and the booking history along with the photo.
 *
 * The first one is the cover, and the screen says so rather than leaving it
 * to be discovered: it is the single image that decides whether anybody opens
 * the listing at all, and a host should know which one they are choosing.
 */
export function SpaceMediaManager({
  media,
  onAdd,
  onRemove,
}: {
  media: SpaceMedia[];
  onAdd: (files: { file: File; kind: "image" | "video" }[]) => Promise<unknown>;
  onRemove: (mediaId: string) => Promise<unknown>;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pick = async (files: FileList | null) => {
    if (!files?.length) return;

    const chosen = Array.from(files).map((file) => ({
      file,
      kind: file.type.startsWith("video") ? ("video" as const) : ("image" as const),
    }));

    // Checked here as well as in the repository, so the message names the file
    // the host actually chose rather than arriving after a failed upload.
    for (const item of chosen) {
      const reason = rejectionReason(item.file, item.kind === "video" ? "video" : "image");
      if (reason) {
        setError(`${item.file.name}: ${reason}`);
        return;
      }
    }

    setError(null);
    setBusy("adding");
    try {
      await onAdd(chosen);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Those did not upload.");
    } finally {
      setBusy(null);
      if (input.current) input.current.value = "";
    }
  };

  const remove = async (mediaId: string) => {
    setError(null);
    setBusy(mediaId);
    try {
      await onRemove(mediaId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That did not delete.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <div className="grid grid-cols-3 gap-2">
        {media.map((item, i) => (
          <div
            key={item.id}
            className="relative rounded-xl overflow-hidden"
            style={{ aspectRatio: "1", border: "1px solid #E7EEF6", opacity: busy === item.id ? 0.4 : 1 }}
          >
            {item.kind === "video" ? (
              <video src={item.url} className="w-full h-full object-cover" muted playsInline />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={item.url} alt="" className="w-full h-full object-cover" />
            )}

            {i === 0 && (
              <span
                className="absolute left-1.5 bottom-1.5 flex items-center gap-1 px-1.5 py-0.5 rounded-full font-body text-[10.5px] text-white"
                style={{ backgroundColor: "rgba(10,26,44,0.6)", backdropFilter: "blur(6px)" }}
              >
                <Star size={9} fill="#fff" /> Cover
              </span>
            )}

            <button
              type="button"
              onClick={() => void remove(item.id)}
              disabled={busy !== null}
              aria-label="Remove this photo"
              className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full flex items-center justify-center press"
              style={{ backgroundColor: "rgba(10,26,44,0.55)", backdropFilter: "blur(6px)" }}
            >
              <X size={12} color="#fff" />
            </button>
          </div>
        ))}

        <button
          type="button"
          onClick={() => input.current?.click()}
          disabled={busy !== null}
          className="rounded-xl flex flex-col items-center justify-center gap-1 press"
          style={{ aspectRatio: "1", border: "1px dashed #DCE7F2", backgroundColor: "#F4F8FC" }}
        >
          <ImagePlus size={17} color="#2670B0" />
          <span className="font-body text-[12px] text-sky-text">
            {busy === "adding" ? "Adding…" : "Add"}
          </span>
        </button>
      </div>

      <input
        ref={input}
        type="file"
        accept="image/*,video/*"
        multiple
        onChange={(e) => void pick(e.target.files)}
        className="hidden"
      />

      <p className="font-body font-normal text-[13.5px] mt-2.5 leading-relaxed text-ink-faint">
        {media.length === 0
          ? "No photos yet. The first one becomes the cover."
          : `${media.length} ${media.length === 1 ? "item" : "items"} · the first is the cover`}
        {" · "}
        up to {Math.round(MAX_BYTES.image / 1_000_000)}MB a photo
      </p>

      {error && (
        <p className="font-body font-normal text-[13.5px] mt-2 text-coral-deep">{error}</p>
      )}
    </div>
  );
}
