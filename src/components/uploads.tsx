"use client";

import { Camera, FileCheck, FileUp, Plus, User, Video, X } from "lucide-react";

export interface PickedMedia {
  id: string;
  file: File;
  url: string;
  kind: "image" | "video";
}

/**
 * Preview URLs are paired with `releasePickedMedia`, which callers must run on
 * removal and on unmount. The prototype minted one of these per pick and never
 * released any, leaking a blob per upload for the lifetime of the tab.
 */
export function createPickedMedia(file: File): PickedMedia {
  return {
    id: crypto.randomUUID(),
    file,
    url: URL.createObjectURL(file),
    kind: file.type.startsWith("video") ? "video" : "image",
  };
}

export function releasePickedMedia(item: PickedMedia): void {
  URL.revokeObjectURL(item.url);
}

/** Verification document upload — sublease proof, certificates of insurance. */
export function DocumentUpload({
  label,
  hint,
  required = false,
  file,
  onPick,
  onRemove,
}: {
  label: string;
  hint: string;
  required?: boolean;
  file: File | null;
  onPick: (file: File) => void;
  onRemove: () => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <p className="font-body text-[11px] text-ink-soft">
          {label}
          {required && <span className="text-coral"> *</span>}
        </p>
        {!required && <span className="font-body text-[9.5px] text-ink-faint">Optional</span>}
      </div>

      {file ? (
        <div
          className="flex items-center gap-2.5 px-4 py-3 rounded-xl"
          style={{ border: "1px solid #D4E8FA", backgroundColor: "#EDF6FE" }}
        >
          <FileCheck size={16} color="#3B9BE8" className="shrink-0" />
          <span className="font-body text-[12px] flex-1 truncate text-navy">{file.name}</span>
          <button type="button" onClick={onRemove} aria-label={`Remove ${label}`}>
            <X size={14} color="#8CA3BD" />
          </button>
        </div>
      ) : (
        <label
          className="flex items-center gap-2.5 px-4 py-3 rounded-xl cursor-pointer press"
          style={{ border: "1px dashed #DCE7F2" }}
        >
          <input
            type="file"
            accept="application/pdf,image/*"
            className="sr-only"
            onChange={(e) => {
              const picked = e.target.files?.[0];
              if (picked) onPick(picked);
              e.target.value = "";
            }}
          />
          <FileUp size={16} color="#3B9BE8" className="shrink-0" />
          <span className="font-body text-[12px] text-ink-faint">{hint}</span>
        </label>
      )}
    </div>
  );
}

/** One square in the listing's photo/video grid. */
export function MediaTile({
  item,
  onRemove,
}: {
  item: PickedMedia;
  onRemove: () => void;
}) {
  return (
    <div className="media-tile media-tile--filled">
      {item.kind === "video" ? (
        <video src={item.url} className="w-full h-full object-cover" muted playsInline loop autoPlay />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element -- blob: preview, not an optimisable asset
        <img src={item.url} alt="" className="w-full h-full object-cover" />
      )}
      {item.kind === "video" && (
        <div className="media-video-badge">
          <Video size={10} color="#fff" />
        </div>
      )}
      <button type="button" onClick={onRemove} className="media-remove press" aria-label="Remove">
        <X size={12} color="#fff" />
      </button>
    </div>
  );
}

export function AddMediaTile({
  label,
  onPick,
}: {
  label: string;
  onPick: (file: File) => void;
}) {
  return (
    <label className="media-tile media-tile--empty press">
      <input
        type="file"
        accept="image/*,video/*"
        className="sr-only"
        onChange={(e) => {
          const picked = e.target.files?.[0];
          if (picked) onPick(picked);
          e.target.value = "";
        }}
      />
      <Plus size={18} color="#3B9BE8" />
      <span className="font-body text-[9.5px] font-medium mt-1 text-navy">{label}</span>
    </label>
  );
}

export function AvatarUpload({
  photoUrl,
  onPick,
  size = 84,
}: {
  photoUrl: string | null;
  onPick: (file: File) => void;
  size?: number;
}) {
  return (
    <label className="relative inline-block cursor-pointer press" style={{ width: size, height: size }}>
      <input
        type="file"
        accept="image/*"
        className="sr-only"
        onChange={(e) => {
          const picked = e.target.files?.[0];
          if (picked) onPick(picked);
          e.target.value = "";
        }}
      />
      <div
        className="rounded-full overflow-hidden flex items-center justify-center"
        style={{
          width: size,
          height: size,
          backgroundColor: "rgba(255,255,255,0.14)",
          border: "2px solid rgba(255,255,255,0.3)",
        }}
      >
        {photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- blob: preview, not an optimisable asset
          <img src={photoUrl} alt="" className="w-full h-full object-cover" />
        ) : (
          <User size={Math.round(size * 0.42)} color="#fff" />
        )}
      </div>
      <div
        className="absolute bottom-0 right-0 rounded-full flex items-center justify-center"
        style={{ width: 26, height: 26, backgroundColor: "#3B9BE8", border: "2px solid #16304E" }}
      >
        <Camera size={12} color="#fff" />
      </div>
    </label>
  );
}
