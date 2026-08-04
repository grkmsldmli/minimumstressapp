"use client";

import { Home, Loader2 } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import type { AddressSuggestion, ResolvedAddress } from "@/lib/geo";
import { MIN_QUERY_LENGTH } from "@/lib/geocode";

/** Opaque per-address-entry id. Not a secret; it only groups calls for billing. */
function newSession(): string {
  return crypto.randomUUID();
}

/**
 * The address field, with the list of places the host might mean.
 *
 * Typing stays authoritative: the field is an ordinary text input that accepts
 * anything, and the dropdown only offers. A host with a rural address no
 * provider has heard of must still be able to list their space, so no path
 * through this component can leave them unable to proceed — including the one
 * where a chosen prediction fails to resolve.
 */
export function AddressAutocomplete({
  value,
  onChange,
  onSelect,
}: {
  value: string;
  onChange: (value: string) => void;
  /** Fired only on a real choice, and always with coordinates in hand. */
  onSelect: (address: ResolvedAddress) => void;
}) {
  const listId = useId();
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);
  const [resolving, setResolving] = useState(false);

  const wrapRef = useRef<HTMLDivElement>(null);
  // What the host chose, so re-rendering with that exact text does not
  // immediately reopen the dropdown offering them what they already picked.
  const acceptedRef = useRef<string | null>(null);

  /**
   * One session covers every keystroke of a single address plus the lookup
   * that ends it, and the provider bills it once instead of per character.
   * Replaced after each completed choice, because the next address a host
   * types is a new question.
   */
  const sessionRef = useRef<string>(newSession());

  /**
   * Whether the query is long enough to have meant anything.
   *
   * Derived at render rather than cleared in the effect. Clearing meant three
   * setState calls firing synchronously every time someone deleted a
   * character, each one a re-render, to reach a state the query already
   * describes. Deleting back to two characters hides the list immediately
   * because the list is a function of the query, not a race against it.
   */
  const tooShort = value.trim().length < MIN_QUERY_LENGTH;
  const visible = tooShort ? [] : suggestions;

  useEffect(() => {
    const query = value.trim();

    // Nothing to ask, and the cleanup below has already stopped whatever was
    // in flight for the longer query this one was cut down from.
    if (query === acceptedRef.current) return;
    if (query.length < MIN_QUERY_LENGTH) return;

    const controller = new AbortController();

    // A request per keystroke would be several per word. A pause long enough
    // to be deliberate but short enough to feel immediate.
    const timer = setTimeout(async () => {
      // Set here rather than above, so the spinner means a request is in
      // flight rather than a keystroke was typed. During the pause nothing is
      // happening and there is nothing to wait for.
      setLoading(true);
      try {
        const response = await fetch(
          `/api/geocode?q=${encodeURIComponent(query)}&session=${sessionRef.current}`,
          { signal: controller.signal },
        );
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

  const accept = async (suggestion: AddressSuggestion) => {
    acceptedRef.current = suggestion.addressLine.trim();
    setOpen(false);
    setSuggestions([]);
    setHighlighted(-1);

    // A geocoder already answered this; only a prediction has to go and ask.
    if (suggestion.lat !== null && suggestion.lng !== null) {
      onSelect({
        addressLine: suggestion.addressLine,
        lat: suggestion.lat,
        lng: suggestion.lng,
      });
      sessionRef.current = newSession();
      return;
    }

    if (!suggestion.placeId) return;

    setResolving(true);
    try {
      const response = await fetch(
        `/api/geocode/resolve?placeId=${encodeURIComponent(suggestion.placeId)}&session=${sessionRef.current}`,
      );
      const body = (await response.json()) as { resolved?: ResolvedAddress | null };

      if (body.resolved) {
        // The provider's own formatting of the address it just located, which
        // is more complete than the two lines shown in the dropdown.
        const addressLine = body.resolved.addressLine || suggestion.addressLine;
        acceptedRef.current = addressLine.trim();
        onSelect({ ...body.resolved, addressLine });
      } else {
        // Text kept, pin not placed. The host can still type and drop it
        // themselves, which is why the field never depended on this working.
        onChange(suggestion.addressLine);
      }
    } catch {
      onChange(suggestion.addressLine);
    } finally {
      setResolving(false);
      // Session closed either way — a retry is a new question, and reusing a
      // spent token would quietly start billing per call.
      sessionRef.current = newSession();
    }
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      setOpen(false);
      return;
    }

    if (!open || visible.length === 0) return;

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setHighlighted((i) => (i + step + visible.length) % visible.length);
      return;
    }

    // Enter with nothing highlighted keeps whatever was typed, rather than
    // silently accepting a guess the host never looked at.
    if (event.key === "Enter" && highlighted >= 0) {
      event.preventDefault();
      void accept(visible[highlighted]);
    }
  };

  const showEmpty = open && searched && !loading && !tooShort && visible.length === 0;

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
          onFocus={() => visible.length > 0 && setOpen(true)}
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
        {(loading || resolving) && (
          <Loader2 size={13} color="#8CA3BD" className="animate-spin shrink-0" />
        )}
      </div>

      {(open && visible.length > 0) || showEmpty ? (
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
              {visible.map((suggestion, index) => (
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
                      void accept(suggestion);
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
