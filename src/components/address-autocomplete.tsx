"use client";

import { Home, Loader2 } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import type { AddressSuggestion } from "@/lib/geo";
import { MIN_QUERY_LENGTH } from "@/lib/geocode";

/**
 * The address field, with the list of places the host might mean.
 *
 * Typing stays authoritative: the field is an ordinary text input that accepts
 * anything, and the dropdown only offers. A host with a rural address the
 * geocoder has never heard of must still be able to list their space, so no
 * path through this component can leave them unable to proceed.
 */
export function AddressAutocomplete({
  value,
  onChange,
  onSelect,
}: {
  value: string;
  onChange: (value: string) => void;
  /** Fired only on a real choice, and carries the coordinates with it. */
  onSelect: (suggestion: AddressSuggestion) => void;
}) {
  const listId = useId();
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);

  const wrapRef = useRef<HTMLDivElement>(null);
  // What the host chose, so re-rendering with that exact text does not
  // immediately reopen the dropdown offering them what they already picked.
  const acceptedRef = useRef<string | null>(null);

  useEffect(() => {
    const query = value.trim();

    if (query === acceptedRef.current) return;
    if (query.length < MIN_QUERY_LENGTH) {
      setSuggestions([]);
      setSearched(false);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    setLoading(true);

    // A request per keystroke would be several per word. A pause long enough
    // to be deliberate but short enough to feel immediate.
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/geocode?q=${encodeURIComponent(query)}`, {
          signal: controller.signal,
        });
        const body = (await response.json()) as { suggestions?: AddressSuggestion[] };
        setSuggestions(body.suggestions ?? []);
        setSearched(true);
        setHighlighted(-1);
        setOpen(true);
      } catch {
        // Aborted, offline, or the geocoder is unwell. All three mean the same
        // thing here: no list, and the field keeps working.
        setSuggestions([]);
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => {
      clearTimeout(timer);
      controller.abort();
      setLoading(false);
    };
  }, [value]);

  // Tapping elsewhere dismisses the list, including on the map behind it.
  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };

    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const accept = (suggestion: AddressSuggestion) => {
    acceptedRef.current = suggestion.addressLine.trim();
    onSelect(suggestion);
    setOpen(false);
    setSuggestions([]);
    setHighlighted(-1);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      setOpen(false);
      return;
    }

    if (!open || suggestions.length === 0) return;

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setHighlighted((i) => (i + step + suggestions.length) % suggestions.length);
      return;
    }

    // Enter with nothing highlighted keeps whatever was typed, rather than
    // silently accepting a guess the host never looked at.
    if (event.key === "Enter" && highlighted >= 0) {
      event.preventDefault();
      accept(suggestions[highlighted]);
    }
  };

  const showEmpty = open && searched && !loading && suggestions.length === 0;

  return (
    <div ref={wrapRef} className="relative">
      <div
        className="flex items-center gap-2 px-4 py-3 rounded-xl bg-white"
        style={{ border: "1px solid #DCE7F2" }}
      >
        <Home size={13} color="#8CA3BD" />
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          onFocus={() => suggestions.length > 0 && setOpen(true)}
          placeholder="Street address, city"
          aria-label="Street address"
          autoComplete="off"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={highlighted >= 0 ? `${listId}-${highlighted}` : undefined}
          className="font-body text-[13px] outline-none w-full text-navy bg-transparent"
        />
        {loading && <Loader2 size={13} color="#8CA3BD" className="animate-spin shrink-0" />}
      </div>

      {(open && suggestions.length > 0) || showEmpty ? (
        <div
          className="absolute left-0 right-0 top-full mt-1 rounded-xl bg-white overflow-hidden z-30"
          style={{ border: "1px solid #DCE7F2", boxShadow: "0 10px 30px rgba(22,48,78,0.12)" }}
        >
          {showEmpty ? (
            <p className="px-4 py-3 font-body font-light text-[12px] text-ink-faint">
              No match — you can type the address yourself and place the pin on the map.
            </p>
          ) : (
            <ul id={listId} role="listbox" aria-label="Address suggestions">
              {suggestions.map((suggestion, index) => (
                <li key={suggestion.id} role="presentation">
                  <button
                    id={`${listId}-${index}`}
                    type="button"
                    role="option"
                    aria-selected={index === highlighted}
                    onMouseEnter={() => setHighlighted(index)}
                    // Pointer-down, not click: a click fires after blur, and
                    // blur is what closes the list out from under the finger.
                    onPointerDown={(e) => {
                      e.preventDefault();
                      accept(suggestion);
                    }}
                    className="w-full text-left px-4 py-2.5"
                    style={{ backgroundColor: index === highlighted ? "#F1F6FB" : "transparent" }}
                  >
                    <span className="block font-body text-[13px] text-navy">
                      {suggestion.primary}
                    </span>
                    {suggestion.secondary && (
                      <span className="block font-body font-light text-[11px] text-ink-faint">
                        {suggestion.secondary}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
