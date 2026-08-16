"use client";

/**
 * A number with a unit stuck to the end of it.
 *
 * Both calculators want the same thing a dozen times over, and the two pages
 * had already started drifting apart on padding and border colour while they
 * were being written.
 */
export function MeasureField({
  label,
  unit,
  value,
  onChange,
  placeholder,
  hint,
}: {
  label: string;
  unit: string;
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
  /** Where to put the tape, mostly. Absent when it is obvious. */
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="block text-[11px] uppercase tracking-[0.1em]" style={{ color: "#8a94a3" }}>
        {label}
      </span>

      <span
        className="mt-1.5 flex overflow-hidden rounded-xl"
        style={{ border: "1px solid #e7eef6" }}
      >
        <input
          type="number"
          inputMode="decimal"
          value={value}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
          className="w-full min-w-0 bg-white px-4 py-3.5 text-[16px] outline-none"
          style={{ color: "#0F2F55" }}
        />
        <span
          className="flex items-center px-4 text-[13px]"
          style={{ backgroundColor: "#f8fbfd", color: "#8a94a3" }}
        >
          {unit}
        </span>
      </span>

      {hint && (
        <span className="mt-1 block text-[12px] leading-snug" style={{ color: "#98a2b3" }}>
          {hint}
        </span>
      )}
    </label>
  );
}

/** Metric or imperial, as a pair of pills. */
export function UnitToggle<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly T[];
  value: T;
  onChange: (next: T) => void;
}) {
  return (
    <div
      className="inline-flex rounded-full p-1"
      style={{ backgroundColor: "#f1f5f9" }}
      role="group"
      aria-label="Units"
    >
      {options.map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => onChange(option)}
          aria-pressed={value === option}
          className="rounded-full px-5 py-2 text-[14px] font-medium capitalize"
          style={
            value === option
              ? { backgroundColor: "#0F2F55", color: "#fff" }
              : { color: "#5f6673" }
          }
        >
          {option}
        </button>
      ))}
    </div>
  );
}
