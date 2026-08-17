"use client";

import { useState } from "react";
import { AlertTriangle, ArrowLeft } from "lucide-react";

import { AccessEditor } from "@/components/access-editor";
import { AddressAutocomplete } from "@/components/address-autocomplete";
import { DocumentStatus } from "@/components/document-status";
import { LocationMap } from "@/components/location-map";
import { PrimaryButton } from "@/components/primitives";
import { SpaceMediaManager } from "@/components/space-media-manager";
import { errorMessage } from "@/lib/error-message";
import type { HostSpace, SpaceEdit } from "@/lib/domain";
import { type LatLng, toBrowsePosition } from "@/lib/geo";
import { MIN_DESCRIPTION_CHARS, describesTheRoom } from "@/lib/listing-quality";
import { PARKING_LIMIT_OPTIONS, PARKING_OPTIONS, limitOutlastsSession } from "@/lib/parking";
import { formatCents, quote } from "@/lib/money";
import { spaceTypesFor } from "@/lib/space-types";
import { type CategoryKey, CATEGORY_KEYS, roomTypeFor } from "@/lib/taxonomy";
import { usePointZone } from "@/lib/use-point-zone";

/**
 * Editing a listing that already exists.
 *
 * Until now there was no way to change one. A wrong rate or an old door code
 * meant delisting and starting again, which throws away the reviews and the
 * history along with the mistake.
 *
 * What a host may change, and what it costs, is one sentence: a change must
 * never rewrite something somebody has already agreed to. Everything on this
 * screen is that sentence applied to a field, and the screen says which is
 * which before the change is made rather than after it is refused.
 */
export function EditSpace({
  space,
  bookedSessions,
  onSave,
  onAddMedia,
  onRemoveMedia,
  onSetListed,
  onEditHours,
  onBack,
}: {
  space: HostSpace;
  /** Sessions still ahead on this listing. Locks the address and room type. */
  bookedSessions: number;
  onSave: (edit: SpaceEdit) => Promise<unknown>;
  onAddMedia: (files: { file: File; kind: "image" | "video" }[]) => Promise<unknown>;
  onRemoveMedia: (mediaId: string) => Promise<unknown>;
  onSetListed: (listed: boolean) => Promise<unknown>;
  onEditHours: () => void;
  onBack: () => void;
}) {
  const [name, setName] = useState(space.name);
  const [rate, setRate] = useState(String(Math.round(space.hourlyRateCents / 100)));
  const [capacity, setCapacity] = useState(String(space.capacity));
  const [entry, setEntry] = useState(space.entryInstructions);
  const [buffer, setBuffer] = useState(String(space.bufferMinutes));
  const [category, setCategory] = useState(space.category);
  const [address, setAddress] = useState(space.addressLine);
  /**
   * Where the address actually is, which the old free-text field never asked.
   *
   * Null for a listing predating the geocoder, and null again the moment the
   * text is edited — the coordinates belonged to the address that was picked,
   * and carrying them over is how a listing moves city on paper while its map,
   * its distance ranking and its browse pin all stay put.
   */
  /**
   * The town of a newly chosen address, or null while it is the old one.
   *
   * Null is the normal state and means "do not touch what is stored". It is
   * only filled by picking an address from the list, which is the only moment
   * a geocoder has actually told us the town.
   */
  const [place, setPlace] = useState<{
    city: string | null;
    state: string | null;
    postalCode: string | null;
  } | null>(null);
  /** What the room is bookable for. Free to change, bookings or not. */
  const [suitableFor, setSuitableFor] = useState<string[]>(space.suitableFor);
  const [point, setPoint] = useState<LatLng | null>(
    space.lat !== null && space.lng !== null ? { lat: space.lat, lng: space.lng } : null,
  );
  /*
   * The zone the pin now sits in, re-asked of the server as it moves.
   *
   * Availability is stored as wall-clock minutes and needs the room's own zone
   * to become real instants (0029). A listing that moves to another zone while
   * keeping the old one publishes its open hours at the wrong time of day and
   * accepts bookings for hours it is shut — quietly, since every screen still
   * renders a plausible-looking grid.
   */
  const timeZone = usePointZone(point);
  const [access, setAccess] = useState(space.access);
  const [description, setDescription] = useState(space.description);
  const [floorArea, setFloorArea] = useState(
    space.floorAreaSqft === null ? "" : String(space.floorAreaSqft),
  );
  const [parking, setParking] = useState<string[]>(space.parking.options);
  const [parkingLimit, setParkingLimit] = useState<number | null>(space.parking.limitMinutes);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rateCents = Math.round(Number(rate) * 100);
  const rateIsNumber = rate.trim() !== "" && Number.isFinite(rateCents) && rateCents > 0;

  const locked = bookedSessions > 0;

  const addressEdited = address.trim() !== space.addressLine;
  // Nudging the pin without touching the text is a move too — 0019 compares
  // lat and lng, not just the string.
  const movedPoint = point && (point.lat !== space.lat || point.lng !== space.lng) ? point : null;
  /** Address typed over but never resolved, so there is no place to save. */
  const unplaced = !locked && addressEdited && point === null;

  const moving = !locked && (addressEdited || movedPoint !== null || category !== space.category);

  const changed =
    name !== space.name ||
    (rateIsNumber && rateCents !== space.hourlyRateCents) ||
    Number(capacity) !== space.capacity ||
    entry !== space.entryInstructions ||
    Number(buffer) !== space.bufferMinutes ||
    category !== space.category ||
    addressEdited ||
    movedPoint !== null ||
    access.entrance !== space.access.entrance ||
    access.floor !== space.access.floor ||
    access.doorwayInches !== space.access.doorwayInches ||
    access.restroom !== space.access.restroom ||
    description !== space.description ||
    floorArea !== (space.floorAreaSqft === null ? "" : String(space.floorAreaSqft)) ||
    parking.join() !== space.parking.options.join() ||
    parkingLimit !== space.parking.limitMinutes ||
    suitableFor.join() !== space.suitableFor.join();

  const toggleListed = async () => {
    setError(null);
    try {
      await onSetListed(space.status === "delisted");
    } catch (cause) {
      setError(errorMessage(cause, "That did not change."));
    }
  };

  const save = async () => {
    if (!rateIsNumber) {
      setError("Enter an hourly rate.");
      return;
    }

    /*
     * Refused rather than saved as text alone. Saving the string on its own is
     * what this screen used to do, and it is how a listing ends up reading one
     * address while every map and every distance still points at the last one.
     */
    if (unplaced) {
      setError("Pick the new address from the list so we know where it is.");
      return;
    }

    setError(null);
    setSaving(true);
    try {
      await onSave({
        name: name.trim(),
        hourlyRateCents: rateCents,
        capacity: Number(capacity),
        entryInstructions: entry.trim(),
        description: description.trim(),
        parking: { options: parking, limitMinutes: parkingLimit },
        floorAreaSqft: floorArea === "" ? null : Number(floorArea),
        bufferMinutes: Number(buffer),
        entranceAccess: access.entrance,
        floorAccess: access.floor,
        doorwayInches: access.doorwayInches,
        restroomAccess: access.restroom,
        // Not part of the move: nobody booked a session on the strength of a
        // room being marked good for pilates, so this is free to change even
        // while the address is locked.
        suitableFor,
        // Only sent when they are actually free to change, so a locked
        // listing cannot be moved by a stale value sitting in a field.
        ...(locked
          ? {}
          : {
              category,
              addressLine: address.trim(),
              // The address and everything derived from it travel together.
              // mapX/mapY place the browse pin, timeZone is what turns the
              // open hours back into real instants — all three read the same
              // point, so all three move with it or none of them do.
              ...(movedPoint
                ? {
                    lat: movedPoint.lat,
                    lng: movedPoint.lng,
                    ...toBrowsePosition(movedPoint),
                    timeZone,
                  }
                : {}),
              /*
               * The town, only when a new address was actually resolved.
               *
               * Deliberately keyed off `place` rather than `movedPoint`. A
               * host who drags the pin a few metres onto the right door has
               * not changed town, and there is nothing to send — but the drag
               * does move the point, so sending this with the bundle above
               * would write the null that `place` holds in that case and drop
               * the listing off its city page for a correction to a doorway.
               */
              ...(place
                ? { city: place.city, state: place.state, postalCode: place.postalCode }
                : {}),
            }),
      });
      onBack();
    } catch (cause) {
      setSaving(false);
      setError(errorMessage(cause, "That did not save."));
    }
  };

  return (
    <div className="h-full flex flex-col screen-in bg-white">
      <div className="px-6 pt-8 pb-5 shrink-0 flex items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back"
          className="w-9 h-9 rounded-full flex items-center justify-center press shrink-0"
          style={{ backgroundColor: "#F4F8FC", border: "1px solid #E7EEF6" }}
        >
          <ArrowLeft size={16} color="#16304E" />
        </button>
        <div className="min-w-0">
          <p className="font-display italic font-semibold text-[19px] truncate text-navy">
            {space.name}
          </p>
          <p className="font-body font-normal text-[13.5px] text-ink-faint">
            {roomTypeFor(space.category)}
          </p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 pb-8">
        <Label>Photos</Label>
        <SpaceMediaManager media={space.media} onAdd={onAddMedia} onRemove={onRemoveMedia} />

        <Label>Space name</Label>
        <Text value={name} onChange={setName} />

        {/*
          The paragraph the listing has always rendered and nothing ever
          collected, so every real listing showed a gap where this belongs.
        */}
        <Label>About this room</Label>
        <Text value={description} onChange={(v) => setDescription(v.slice(0, 1200))} multiline />
        {/*
          Shown only while it is short. A listing that already reads well does
          not need a character count following it around.
        */}
        {!describesTheRoom(description) && (
          <p className="font-body font-normal text-[13px] mt-1.5 text-ink-faint">
            {description.trim().length} of {MIN_DESCRIPTION_CHARS} characters — this is the first
            thing a practitioner reads.
          </p>
        )}

        <Label>Hourly rate (you keep this)</Label>
        <div className="flex items-center gap-1 rounded-xl px-3.5 py-3" style={FIELD}>
          <span className="font-body font-medium text-[15px] text-navy">$</span>
          <input
            value={rate}
            onChange={(e) => setRate(e.target.value.replace(/[^\d.]/g, ""))}
            inputMode="decimal"
            aria-label="Hourly rate in dollars"
            className="font-body text-[15px] outline-none w-full text-navy"
          />
        </div>
        <p className="font-body font-normal text-[13.5px] mt-1.5 text-ink-faint">
          {rateIsNumber
            ? `Lists at ${formatCents(quote({ hostRateCents: rateCents, isInstant: false, isPro: false }).totalCents)}/hr`
            : "Lists at —"}
        </p>
        {/*
          Bookings freeze their own money when they are made, so a rate change
          cannot reach one that already exists. Worth saying plainly: a host
          raising their rate should not be wondering whether they have just
          overcharged somebody who booked last week.
        */}
        {rateIsNumber && rateCents !== space.hourlyRateCents && (
          <Note>Sessions already booked keep the price they were booked at.</Note>
        )}

        <Label>Capacity</Label>
        <Text value={capacity} onChange={(v) => setCapacity(v.replace(/[^\d]/g, ""))} />

        <Label>How does a practitioner get in?</Label>
        <Text value={entry} onChange={setEntry} multiline />

        <Label>Turnover buffer (minutes)</Label>
        <Text value={buffer} onChange={(v) => setBuffer(v.replace(/[^\d]/g, ""))} />

        {/*
          Four questions where there used to be one box marked "accessible".
          That box asked something most hosts could not answer honestly — a
          shallow step at the entrance is neither yes nor no — so it got
          ticked in good faith and somebody was stranded outside.
        */}
        <Label>Getting in</Label>
        <AccessEditor details={access} onChange={setAccess} />

        <Label>Floor area (square feet)</Label>
        <div className="flex items-center gap-2">
          <input
            value={floorArea}
            onChange={(event) => setFloorArea(event.target.value.replace(/[^\d]/g, "").slice(0, 5))}
            inputMode="numeric"
            placeholder="Not given"
            className="font-body text-[15px] outline-none rounded-xl px-3.5 py-3 w-full text-navy"
            style={FIELD}
          />
          <span className="font-body font-normal text-[15px] shrink-0 text-ink-soft">sq ft</span>
        </div>

        <Label>Parking</Label>
        <div className="flex flex-wrap gap-2">
          {PARKING_OPTIONS.map((option) => {
            const on = parking.includes(option.key);
            return (
              <button
                key={option.key}
                type="button"
                onClick={() =>
                  setParking((list) => {
                    if (list.includes(option.key)) return list.filter((k) => k !== option.key);
                    // "No parking" is the absence of the others, not one more.
                    return option.key === "none"
                      ? ["none"]
                      : [...list.filter((k) => k !== "none"), option.key];
                  })
                }
                className="px-3 py-2 rounded-xl font-body text-[14px] press"
                style={{
                  backgroundColor: on ? "#16304E" : "#fff",
                  color: on ? "#fff" : "#16304E",
                  border: `1px solid ${on ? "#16304E" : "#DCE7F2"}`,
                }}
              >
                {option.label}
              </button>
            );
          })}
        </div>

        {parking.length > 0 && !parking.includes("none") && (
          <>
            <Label>How long can a car stay?</Label>
            <div className="flex flex-wrap gap-2">
              {[null, ...PARKING_LIMIT_OPTIONS].map((minutes) => {
                const on = parkingLimit === minutes;
                return (
                  <button
                    key={String(minutes)}
                    type="button"
                    onClick={() => setParkingLimit(minutes)}
                    className="px-3 py-2 rounded-xl font-body text-[14px] press"
                    style={{
                      backgroundColor: on ? "#16304E" : "#fff",
                      color: on ? "#fff" : "#16304E",
                      border: `1px solid ${on ? "#16304E" : "#DCE7F2"}`,
                    }}
                  >
                    {minutes === null ? "No limit" : minutes < 60 ? `${minutes} min` : `${minutes / 60} hr`}
                  </button>
                );
              })}
            </div>
            {parkingLimit !== null && !limitOutlastsSession(parkingLimit) && (
              <Note tone="warn">
                Sessions are an hour. This limit means moving the car before one ends, and
                practitioners will see that on your listing.
              </Note>
            )}
          </>
        )}

        <div className="h-px my-7" style={{ backgroundColor: "#E7EEF6" }} />

        {/*
          Outside the lock. The address and the room type are frozen while
          sessions are booked, because somebody arranged their day around them
          — but nobody booked an hour on the strength of a room being marked
          good for pilates, and a host who has started teaching something else
          should be able to say so today.
        */}
        <SuitableFor category={category} value={suitableFor} onChange={setSuitableFor} />

        {locked ? (
          /*
           * Refused, not re-reviewed. Somebody has arranged their day around a
           * room at this address; moving it underneath them is the harm the
           * cancellation policy exists to prevent, done quietly instead of
           * with a notification. Shown as a locked state rather than as a
           * field that throws when saved.
           */
          <div
            className="rounded-xl px-3.5 py-3 flex items-start gap-2.5"
            style={{ backgroundColor: "#FFF8F1", border: "1px solid #F5DFC4" }}
          >
            <AlertTriangle size={14} color="#8B6C37" className="mt-0.5 shrink-0" />
            <div>
              <p className="font-body font-medium text-[15px] text-navy">
                Address and room type are locked
              </p>
              <p className="font-body font-normal text-[13.5px] mt-0.5 leading-relaxed text-ink-soft">
                {bookedSessions === 1
                  ? "One session is booked here."
                  : `${bookedSessions} sessions are booked here.`}{" "}
                They can change once those are done.
              </p>
            </div>
          </div>
        ) : (
          <>
            <Label>Room type</Label>
            <div className="flex flex-wrap gap-2">
              {CATEGORY_KEYS.map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setCategory(key)}
                  className="px-3.5 py-2 rounded-full font-body text-[13.5px] press"
                  style={
                    category === key
                      ? { backgroundColor: "#2578C2", color: "#fff" }
                      : { border: "1px solid #DCE7F2", color: "#4D6480" }
                  }
                >
                  {roomTypeFor(key)}
                </button>
              ))}
            </div>

            <Label>Location</Label>
            <AddressAutocomplete
              value={address}
              onChange={(next) => {
                setAddress(next);
                setPoint(null);
                setPlace(null);
              }}
              onSelect={(picked) => {
                setAddress(picked.addressLine);
                setPoint({ lat: picked.lat, lng: picked.lng });
                // Only a resolved address carries a town. Dragging the pin
                // below leaves this alone on purpose — see the note where it
                // is saved.
                setPlace({
                  city: picked.city,
                  state: picked.state,
                  postalCode: picked.postalCode,
                });
              }}
            />
            <p className="font-body font-normal text-[13.5px] mt-2 text-ink-faint">
              Only shown to a practitioner once they&apos;ve booked — never public.
            </p>

            <div className="mt-3">
              <LocationMap point={point} onPick={point ? setPoint : undefined} />
            </div>

            {moving && (
              <Note tone="warn">
                Changing the address or room type takes this listing off search until we have
                checked it again.
              </Note>
            )}
          </>
        )}

        <div className="h-px my-7" style={{ backgroundColor: "#E7EEF6" }} />

        <p className="font-body font-semibold text-[12px] uppercase tracking-[0.2em] mb-3 text-sky-text">
          Your documents
        </p>
        <div className="flex flex-col gap-2.5">
          <DocumentStatus
            label="Proof you can sublease"
            fileName={space.subleaseDocName}
            review={space.subleaseReview}
            note={space.reviewNote}
          />
          <DocumentStatus
            label="Space insurance"
            fileName={space.insuranceDocName}
            review={space.insuranceReview}
            optional
          />
        </div>

        <div className="h-px my-7" style={{ backgroundColor: "#E7EEF6" }} />

        <p className="font-body font-semibold text-[12px] uppercase tracking-[0.2em] mb-3 text-sky-text">
          This listing
        </p>

        <div className="flex flex-col gap-2.5">
          <Line
            label="Open hours"
            value={
              space.availability.length === 0
                ? "None set"
                : `${space.availability.length} ${space.availability.length === 1 ? "block" : "blocks"} a week`
            }
            action="Change"
            onAction={onEditHours}
          />
          {/*
            "Take it down" said nothing about what it took down, or where to.
            The word people reach for is hiding, and the thing they are afraid
            of is losing the listing — so both are answered on the row itself.
          */}
          <Line
            label="Status"
            value={
              space.status === "active"
                ? "Live — practitioners can book it"
                : space.status === "pending"
                  ? "Waiting on review"
                  : "Hidden — nobody can book it"
            }
            action={space.status === "delisted" ? "Show it again" : "Hide it"}
            onAction={() => void toggleListed()}
          />
        </div>

        {space.status !== "delisted" && (
          <Note>
            Hiding a listing takes it out of search and stops new bookings. Nothing is deleted, and
            you can show it again whenever you like.
          </Note>
        )}

        {/*
          Delisting is not deletion, and it never touches a booking that
          already exists. Sessions on the calendar go ahead — cancelling them
          to tidy up a listing lands the harm on somebody who did nothing,
          which is the same rule the suspension policy runs on.
        */}
        {space.status !== "delisted" && bookedSessions > 0 && (
          <Note>
            {bookedSessions === 1 ? "One session stays" : `${bookedSessions} sessions stay`} on the
            calendar either way.
          </Note>
        )}

        {error && (
          <p className="font-body font-normal text-[13.5px] mt-4 text-coral-deep">{error}</p>
        )}

        <div className="mt-6">
          {/*
            Not blocked on the description.
            
            It was, and that was wrong twice over: the button went dead with no
            reason given anywhere near it, and it held every unrelated edit
            hostage — a host adding parking had to write a paragraph first. The
            requirement belongs on creating a listing, where there is nothing to
            hold up. Here it is a prompt, and the host's own dashboard keeps
            asking.
          */}
          <PrimaryButton onClick={() => void save()} disabled={!changed || saving}>
            {saving ? "Saving…" : changed ? "Save changes" : "Nothing changed"}
          </PrimaryButton>
        </div>
      </div>
    </div>
  );
}

const FIELD = { border: "1px solid #DCE7F2", backgroundColor: "#fff" } as const;

/**
 * What the room is bookable for.
 *
 * The finer question under "room type", and the one a practitioner actually
 * searches with — nobody looks for a movement studio, they look for a pilates
 * studio, and the same floor is both. It is what puts a listing on the pages
 * built around a use.
 *
 * Optional, and left that way on edit as well as on create: a host who ticks
 * nothing keeps a listing that browses and books, and simply misses those
 * pages. The row is a named group because four of these labels are also room
 * type names, and two identical words on one screen have to be tellable apart.
 */
function SuitableFor({
  category,
  value,
  onChange,
}: {
  category: CategoryKey;
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const toggle = (slug: string) =>
    onChange(value.includes(slug) ? value.filter((s) => s !== slug) : [...value, slug]);

  return (
    <>
      <p
        id="edit-good-for-label"
        className="font-body font-semibold text-[12px] uppercase tracking-[0.2em] mt-6 mb-2 text-sky-text"
      >
        Good for <span className="text-ink-faint">(optional)</span>
      </p>
      <div className="flex flex-wrap gap-2" role="group" aria-labelledby="edit-good-for-label">
        {spaceTypesFor(category).map((type) => {
          const on = value.includes(type.slug);
          return (
            <button
              key={type.slug}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(type.slug)}
              className="px-3.5 py-2 rounded-full font-body text-[13.5px] press"
              style={
                on
                  ? { backgroundColor: "#2578C2", color: "#fff" }
                  : { border: "1px solid #DCE7F2", color: "#4D6480" }
              }
            >
              {type.label}
            </button>
          );
        })}
      </div>
      <p className="font-body font-normal text-[13.5px] mt-2 text-ink-faint">
        This is how people find you. Someone searching for a pilates studio near them sees rooms
        marked for pilates.
      </p>
    </>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <p className="font-body font-semibold text-[12px] uppercase tracking-[0.2em] mt-6 mb-2 text-sky-text">
      {children}
    </p>
  );
}

function Note({ children, tone = "plain" }: { children: React.ReactNode; tone?: "plain" | "warn" }) {
  return (
    <p
      className="font-body font-normal text-[13.5px] mt-2 leading-relaxed"
      style={{ color: tone === "warn" ? "#8B6C37" : "#566D85" }}
    >
      {children}
    </p>
  );
}

function Line({
  label,
  value,
  action,
  onAction,
}: {
  label: string;
  value: string;
  action: string;
  onAction: () => void;
}) {
  return (
    <div
      className="rounded-xl px-3.5 py-3 flex items-center gap-3"
      style={{ backgroundColor: "#F4F8FC", border: "1px solid #E7EEF6" }}
    >
      <div className="min-w-0 flex-1">
        <p className="font-body font-medium text-[15px] text-navy">{label}</p>
        <p className="font-body font-normal text-[13.5px] mt-0.5 text-ink-soft">{value}</p>
      </div>
      <button
        type="button"
        onClick={onAction}
        className="font-body font-medium text-[15px] shrink-0 press text-sky-text"
      >
        {action}
      </button>
    </div>
  );
}

function Text({
  value,
  onChange,
  multiline = false,
}: {
  value: string;
  onChange: (value: string) => void;
  multiline?: boolean;
}) {
  const shared = "font-body text-[15px] outline-none w-full text-navy rounded-xl px-3.5 py-3";

  return multiline ? (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      rows={3}
      className={`${shared} resize-none`}
      style={FIELD}
    />
  ) : (
    <input value={value} onChange={(e) => onChange(e.target.value)} className={shared} style={FIELD} />
  );
}
