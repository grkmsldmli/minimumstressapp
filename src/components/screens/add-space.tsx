"use client";
import { useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Bath,
  Check,
  DollarSign,
  ShieldCheck,
  Timer,
  Users,
} from "lucide-react";
import { AddressAutocomplete } from "@/components/address-autocomplete";
import { Ambient, BreathingLogo, CatIcon, Headline } from "@/components/brand";
import { LocationMap } from "@/components/location-map";
import { ConfettiBurst, PrimaryButton } from "@/components/primitives";
import {
  AddMediaTile,
  MediaTile,
  type PickedMedia,
  createPickedMedia,
  releasePickedMedia,
} from "@/components/uploads";
import { DocumentUpload } from "@/components/uploads";
import { WeekSchedule } from "@/components/week-schedule";
import { AccessEditor } from "@/components/access-editor";
import type { AccessDetails } from "@/lib/access-details";
import { usePointZone } from "@/lib/use-point-zone";
import { MIN_DESCRIPTION_CHARS, describesTheRoom } from "@/lib/listing-quality";
import { SUPPORT_EMAIL } from "@/lib/company";
import { PARKING_LIMIT_OPTIONS, PARKING_OPTIONS } from "@/lib/parking";
import { milesOutside } from "@/lib/service-area";
import { zoneAbbreviation } from "@/lib/timezone";
import type { AvailabilityBlock } from "@/lib/availability";
import { isValidSchedule } from "@/lib/availability";
import type { NewSpaceInput } from "@/lib/domain";
import { type LatLng, toBrowsePosition } from "@/lib/geo";
import { formatCents, isViableHostRate, minViableHostRateCents, quote } from "@/lib/money";
import {
  ACCESS_TYPES,
  AMENITY_GROUPS,
  ROOM_SETUPS,
  type RoomSetupKey,
  amenitiesIn,
  BUFFER_OPTIONS,
  CATEGORIES,
  REQUIREMENTS,
  REQUIREMENT_GROUPS,
  type AccessTypeKey,
  type CategoryKey,
  RESTROOM_OPTIONS,
  type RestroomOption,
  formatBuffer,
} from "@/lib/taxonomy";
import { spaceTypesFor } from "@/lib/space-types";
const MAX_MEDIA = 6;
const STEP_LABELS = ["Basics", "Photos & extras", "Verify"] as const;
export function AddSpace({
  onBack,
  onListed,
}: {
  onBack: () => void;
  onListed: (input: NewSpaceInput) => Promise<void>;
}) {
  const [step, setStep] = useState(1);
  const [listed, setListed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // Step 1 — every field here is required by the brief.
  const [name, setName] = useState("");
  /**
   * Real coordinates, set by choosing from the dropdown and adjustable by
   * tapping the map. Null until then, and required to advance: an address
   * nobody can find is a practitioner standing on the wrong street.
   */
  const [point, setPoint] = useState<LatLng | null>(null);
  /**
   * Which clock the hours below are on.
   *
   * Derived from the pin rather than asked for. The host is describing a room,
   * and the room's timezone is a fact about where it stands — one more question
   * on this form would only add a way to answer it wrongly.
   */
  const timeZone = usePointZone(point);
  const [address, setAddress] = useState("");
  /**
   * The town, from the geocoder rather than from the address text.
   *
   * This is what puts the listing on a city page. Null where the provider did
   * not tell us — nothing here guesses, because a listing filed under the
   * wrong town is worse than one filed under none.
   */
  const [place, setPlace] = useState<{
    city: string | null;
    state: string | null;
    postalCode: string | null;
  } | null>(null);
  const [category, setCategory] = useState<CategoryKey | null>(null);
  /**
   * What the room is bookable for, which is not the same question as its
   * category. A movement studio can be hired for yoga and for pilates, and a
   * host who teaches neither still knows which their floor suits.
   */
  const [suitableFor, setSuitableFor] = useState<string[]>([]);
  /** Whether the room is theirs for the hour, or a corner of somewhere busier. */
  const [roomSetup, setRoomSetup] = useState<RoomSetupKey>("private_room");
  const [rate, setRate] = useState("");
  const [capacity, setCapacity] = useState("");
  const [accessType, setAccessType] = useState<AccessTypeKey | null>(null);
  const [entryInstructions, setEntryInstructions] = useState("");
  // Step 2 — only the media is required.
  const [media, setMedia] = useState<PickedMedia[]>([]);
  const [amenities, setAmenities] = useState<string[]>([]);
  const [parking, setParking] = useState<string[]>([]);
  const [floorArea, setFloorArea] = useState("");
  const [parkingLimit, setParkingLimit] = useState<number | null>(null);
  const [requirements, setRequirements] = useState<string[]>([]);
  const [houseRules, setHouseRules] = useState("");
  const [description, setDescription] = useState("");
  const [access, setAccess] = useState<AccessDetails>({
    entrance: null,
    floor: null,
    doorwayInches: null,
    restroom: null,
  });
  const [restroom, setRestroom] = useState<RestroomOption | null>(null);
  const [blocks, setBlocks] = useState<AvailabilityBlock[]>([]);
  const [bufferMinutes, setBufferMinutes] = useState<number>(0);
  // Step 3
  const [subleaseDoc, setSubleaseDoc] = useState<File | null>(null);
  const [insuranceDoc, setInsuranceDoc] = useState<File | null>(null);
  const [agreed, setAgreed] = useState(false);
  // Release every preview URL when the wizard unmounts, whether the listing
  // was submitted or abandoned.
  useEffect(
    () => () => {
      for (const item of media) releasePickedMedia(item);
    },
    // Intentionally on unmount only; removals revoke their own URL below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const rateCents = Math.round(Number(rate) * 100);
  const rateIsNumber = rate !== "" && Number.isFinite(Number(rate)) && rateCents > 0;
  /*
   * Checked here rather than at submit.
   *
   * A studio outside the launch area can fill in every field, photograph the
   * room, upload a lease and set up payouts — and then wait for a practitioner
   * who is two hundred miles away. Taking all of that first and refusing after
   * is worse than refusing, so the address is where it is said.
   */
  const outsideBy = point ? milesOutside(point) : 0;
  const outside = point !== null && outsideBy > 0;
  const canStep1 =
    name.trim() !== "" &&
    point !== null &&
    !outside &&
    address.trim() !== "" &&
    category !== null &&
    rateIsNumber &&
    isViableHostRate(rateCents) &&
    Number(capacity) > 0 &&
    accessType !== null &&
    entryInstructions.trim() !== "";
  /*
   * The description is required here rather than left optional, because
   * optional is what it was: three listings went live without one, and the
   * listing screen hides an empty paragraph so nobody ever saw the gap except
   * the practitioner deciding not to book.
   */
  const canStep2 =
    media.length >= 1 && isValidSchedule(blocks) && describesTheRoom(description);
  const canSubmit = subleaseDoc !== null && agreed;
  const canAdvance = step === 1 ? canStep1 : step === 2 ? canStep2 : canSubmit;
  /*
   * What is still missing, named.
   *
   * Step one asks for nine things and the button simply greys out, so a host
   * who missed one — the room type is the easy one to scroll past — is left
   * comparing a dead button against a form that looks full. Naming it costs a
   * line and saves the guess.
   */
  const missing: string[] = [];
  if (step === 1) {
    if (name.trim() === "") missing.push("a name");
    if (address.trim() === "" || point === null) missing.push("an address you picked from the list");
    if (category === null) missing.push("a room type");
    if (!rateIsNumber || !isViableHostRate(rateCents)) missing.push("an hourly rate");
    if (!(Number(capacity) > 0)) missing.push("how many people fit");
    if (accessType === null) missing.push("how somebody gets in");
    if (entryInstructions.trim() === "") missing.push("the entry instructions");
  } else if (step === 2) {
    if (media.length < 1) missing.push("at least one photo");
    if (!describesTheRoom(description)) missing.push("a description of the room");
    if (!isValidSchedule(blocks)) missing.push("some hours somebody can book");
  } else {
    if (subleaseDoc === null) missing.push("proof you can sublet the room");
    if (!agreed) missing.push("the acknowledgement");
  }
  const addMedia = (file: File) => {
    if (media.length >= MAX_MEDIA) return;
    setMedia((m) => [...m, createPickedMedia(file)]);
  };
  const removeMedia = (item: PickedMedia) => {
    releasePickedMedia(item);
    setMedia((m) => m.filter((i) => i.id !== item.id));
  };
  /**
   * Listing is the one action here that reaches a database, a storage bucket
   * and back — so it is the one that can fail for reasons a host cannot guess.
   * It failed silently once: the promise rejected, the success screen never
   * came, and the button simply did nothing twice in a row.
   */
  const submit = async () => {
    if (!canSubmit || !category || !accessType || !point || submitting) return;
    setSubmitError(null);
    setSubmitting(true);
    try {
      await onListed({
        name: name.trim(),
        category,
        hourlyRateCents: rateCents,
        capacity: Number(capacity),
        accessType,
        entryInstructions: entryInstructions.trim(),
        addressLine: address.trim(),
        lat: point.lat,
        lng: point.lng,
        city: place?.city ?? null,
        state: place?.state ?? null,
        postalCode: place?.postalCode ?? null,
        suitableFor,
        roomSetup,
        timeZone,
        // Where the pin sits on the illustrated browse map, which is a separate
        // question from where the studio is — see toBrowsePosition.
        ...toBrowsePosition(point),
        access,
        restroom,
        description: description.trim(),
        amenities,
        parking: { options: parking, limitMinutes: parkingLimit },
        floorAreaSqft: floorArea === "" ? null : Number(floorArea),
        requirements,
        houseRules: houseRules.trim(),
        bufferMinutes,
        availability: blocks,
        media: media.map((m) => ({ file: m.file, kind: m.kind })),
        subleaseDoc: subleaseDoc!,
        insuranceDoc,
      });
      setListed(true);
    } catch (error) {
      setSubmitError(
        error instanceof Error && error.message
          ? error.message
          : "Something went wrong listing your space. Nothing was saved — please try again.",
      );
    } finally {
      setSubmitting(false);
    }
  };
  if (listed) {
    return (
      <div
        className="h-full flex flex-col items-center justify-center text-center px-9 screen-in relative overflow-hidden"
        style={{
          background: "radial-gradient(120% 90% at 50% 0%, #1E4066 0%, #16304E 55%, #0E2138 100%)",
        }}
      >
        <Ambient />
        <ConfettiBurst />
        <div className="relative z-10 flex flex-col items-center">
          <BreathingLogo size={120} />
          <div className="mt-6">
            <Headline pre="Space" accent="listed." size={26} light />
          </div>
          <p className="font-body font-normal text-[14.5px] text-white/70 leading-relaxed mt-3">
            Your listing is in. We&apos;re reviewing your documents — usually the same day — and
            we&apos;ll let you know the moment a practitioner books an open hour.
          </p>
          <button
            type="button"
            onClick={onBack}
            className="mt-7 px-8 py-3.5 rounded-full font-body font-medium text-[14.5px] text-white press"
            style={{ backgroundColor: "#2578C2" }}
          >
            Back to dashboard
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="h-full flex flex-col screen-in bg-white">
      <div
        className="px-6 pt-8 pb-6 relative rounded-b-[30px] overflow-hidden shrink-0"
        style={{ background: "radial-gradient(140% 120% at 15% 0%, #1E4066 0%, #16304E 85%)" }}
      >
        <Ambient />
        <button
          type="button"
          onClick={() => (step === 1 ? onBack() : setStep(step - 1))}
          aria-label="Back"
          className="w-9 h-9 rounded-full flex items-center justify-center press relative z-10"
          style={{ backgroundColor: "rgba(255,255,255,0.14)" }}
        >
          <ArrowLeft size={16} color="#fff" />
        </button>
        <div className="mt-3 relative z-10">
          <Headline pre="List a" accent="new space." size={22} light />
        </div>
        <p className="font-body font-normal text-[13.5px] text-white/55 mt-1 relative z-10">
          Step {step} of 3 · {STEP_LABELS[step - 1]}
        </p>
        <div className="flex gap-1.5 mt-3 relative z-10">
          {[1, 2, 3].map((n) => (
            <div
              key={n}
              className="flex-1 h-[3px] rounded-full overflow-hidden"
              style={{ backgroundColor: "rgba(255,255,255,0.22)" }}
            >
              <div
                className="h-full rounded-full bg-white"
                style={{ width: n <= step ? "100%" : "0%", transition: "width 0.3s ease" }}
              />
            </div>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-6 pt-5 pb-8">
        {step === 1 && (
          <div className="card-in">
            <SectionLabel>Space name</SectionLabel>
            <TextInput value={name} onChange={setName} placeholder="e.g. Willow Reformer Studio" />
            <SectionLabel className="mt-6">Location</SectionLabel>
            <AddressAutocomplete
              value={address}
              onChange={(next) => {
                setAddress(next);
                // Editing the text after choosing invalidates the pin: the
                // coordinates belonged to the address that was picked, and
                // silently keeping them is how a listing ends up on the map a
                // block from where it says it is.
                setPoint(null);
                setPlace(null);
              }}
              onSelect={(picked) => {
                setAddress(picked.addressLine);
                setPoint({ lat: picked.lat, lng: picked.lng });
                /*
                 * The town is kept against the address, not against the pin.
                 *
                 * The map below can move the pin, and it should — it is there
                 * so a host can put it on the right door. But it opens at
                 * street zoom, so a drag is a few metres: it corrects which
                 * entrance, not which town. Re-deriving the town on every drag
                 * would be a geocoder call per pixel to answer a question that
                 * has not changed.
                 */
                setPlace({
                  city: picked.city,
                  state: picked.state,
                  postalCode: picked.postalCode,
                });
              }}
            />
            {/*
              This said the opposite until the address was published, and a
              host consenting on the strength of a promise the app no longer
              keeps is the worst version of a stale sentence. A retail studio's
              address is already on its own website; the door code is what
              needed protecting, and it still is.
            */}
            <p className="font-body font-normal text-[13.5px] mt-2 text-ink-faint">
              Shown on your listing, like any studio&apos;s address. What stays private
              is below: the entry instructions and the code go only to the practitioner
              who booked, shortly before their session.
            </p>
            {/*
              Where we are, not only where we are not. A refusal with no map of
              its own edges reads as a fault in the app, and the number is what
              lets somebody judge for themselves rather than be judged.
            */}
            {outside && (
              <div
                className="rounded-2xl p-4 mt-3"
                style={{ backgroundColor: "#FFF7F5", border: "1px solid #F6D5D0" }}
              >
                <p className="font-body font-medium text-[14.5px] text-navy">
                  That is about {outsideBy} {outsideBy === 1 ? "mile" : "miles"} outside where we
                  have practitioners
                </p>
                <p className="font-body font-normal text-[14px] leading-relaxed mt-1 text-ink-soft">
                  We opened in San Francisco, the peninsula down to San Jose, and the East Bay.
                  Listing a room outside that today means photographing it, writing it up and
                  setting up payouts for a room nobody would find — so this is the moment to say
                  it, not after the afternoon is gone.
                </p>
                <p className="font-body font-normal text-[14px] leading-relaxed mt-2 text-ink-soft">
                  Write to {SUPPORT_EMAIL} and we will come to you sooner. Where studios ask from
                  is how we decide where to open next.
                </p>
              </div>
            )}
            <div className="mt-3">
              <LocationMap point={point} onPick={point ? setPoint : undefined} />
            </div>
            {/*
              Two rows of chips, and four labels appear in both: a Treatment
              Room is a room type above and a use below. That is not a mistake
              — what a room *is* and what it is *good for* are different
              questions, and a movement studio really can be marked as good for
              general movement work. But two identical words on one screen need
              their groups named, or neither a screen reader nor anybody
              skimming can tell which "Treatment Room" they are pressing.
            */}
            <SectionLabel className="mt-6" id="room-type-label">
              Room type
            </SectionLabel>
            <div className="flex flex-wrap gap-2" role="group" aria-labelledby="room-type-label">
              {CATEGORIES.map((c) => (
                <Chip
                  key={c.key}
                  active={category === c.key}
                  onClick={() => {
                    setCategory(c.key);
                    // The uses below belong to the room type above them, so
                    // changing it leaves stale ones selected that are no
                    // longer on screen to unselect.
                    setSuitableFor([]);
                  }}
                >
                  <CatIcon cat={c.key} size={12} />
                  {c.roomType}
                </Chip>
              ))}
            </div>
            {/*
              What the room is bookable for, which is a different question from
              what kind of room it is — and the one a practitioner actually
              searches with. Nobody looks for a "movement studio"; they look
              for a pilates studio, and the same floor is both.
              Optional. A host who does not tick anything still gets a
              listing; it appears in browse and on its own page, and only
              misses the pages built around a use. Making it required would
              trade a real listing for a tidier database.
            */}
            {category && (
              <>
                <SectionLabel className="mt-6" id="good-for-label">
                  Good for <span className="text-ink-faint">(optional, pick any)</span>
                </SectionLabel>
                <div className="flex flex-wrap gap-2" role="group" aria-labelledby="good-for-label">
                  {spaceTypesFor(category).map((type) => (
                    <Chip
                      key={type.slug}
                      active={suitableFor.includes(type.slug)}
                      onClick={() =>
                        setSuitableFor((previous) =>
                          previous.includes(type.slug)
                            ? previous.filter((slug) => slug !== type.slug)
                            : [...previous, type.slug],
                        )
                      }
                    >
                      {type.label}
                    </Chip>
                  ))}
                </div>
                <p className="font-body font-normal text-[13px] leading-relaxed mt-2 text-ink-soft">
                  This is how people find you. Someone searching for a pilates studio near them
                  sees rooms marked for pilates.
                </p>
              </>
            )}
            <div className="grid grid-cols-2 gap-3 mt-5">
              <div>
                <FieldLabel>
                  Hourly rate <span className="text-ink-faint">(you keep this)</span>
                </FieldLabel>
                <div
                  className="flex items-center gap-2 px-4 py-3 rounded-xl"
                  style={{ border: "1px solid #DCE7F2" }}
                >
                  <DollarSign size={13} color="#8CA3BD" />
                  <input
                    type="number"
                    min="0"
                    step="1"
                    inputMode="decimal"
                    value={rate}
                    onChange={(e) => setRate(e.target.value)}
                    placeholder="45"
                    aria-label="Hourly rate in dollars"
                    className="font-body text-[14.5px] outline-none w-full text-navy"
                  />
                </div>
                <p
                  className="font-body text-[13.5px] mt-1.5"
                  style={{ color: rateIsNumber ? "#2670B0" : "#5D768F" }}
                >
                  {rateIsNumber
                    ? `Lists at ${formatCents(quote({ hostRateCents: rateCents, isInstant: false, isPro: false }).totalCents)}/hr`
                    : "Lists at —"}
                </p>
                {/*
                  Under the rate field rather than at the foot of the step. This
                  is the sentence that answers "why is the listed price higher
                  than what I typed", and it was worth nothing three scrolls
                  below the moment that question occurs.
                */}
                <p className="font-body font-normal text-[13.5px] leading-relaxed mt-1.5 text-ink-faint">
                  You keep this in full.
                </p>
              </div>
              <div>
                <FieldLabel>Capacity</FieldLabel>
                <div
                  className="flex items-center gap-2 px-4 py-3 rounded-xl"
                  style={{ border: "1px solid #DCE7F2" }}
                >
                  <Users size={13} color="#8CA3BD" />
                  <input
                    type="number"
                    min="1"
                    inputMode="numeric"
                    value={capacity}
                    onChange={(e) => setCapacity(e.target.value)}
                    placeholder="3"
                    aria-label="Capacity"
                    className="font-body text-[14.5px] outline-none w-full text-navy"
                  />
                </div>
              </div>
            </div>
            {rateIsNumber && !isViableHostRate(rateCents) && (
              <p
                className="font-body font-normal text-[13.5px] mt-2 rounded-xl p-3 leading-relaxed"
                style={{ backgroundColor: "#FEF2F0", border: "1px solid #F5C4BC", color: "#7A4A42" }}
              >
                A rate this low costs more to process than it earns. The minimum is{" "}
                {formatCents(minViableHostRateCents())} an hour.
              </p>
            )}
            {/* Required by the brief, and absent from the prototype's step 1. */}
            <SectionLabel className="mt-6">How does a practitioner get in?</SectionLabel>
            <div className="flex flex-wrap gap-2">
              {ACCESS_TYPES.map((option) => (
                <Chip
                  key={option.key}
                  active={accessType === option.key}
                  onClick={() => setAccessType(option.key)}
                >
                  {option.label}
                </Chip>
              ))}
            </div>
            <textarea
              value={entryInstructions}
              onChange={(e) => setEntryInstructions(e.target.value)}
              placeholder={
                accessType === "greeter"
                  ? "e.g. Ring the bell marked 2B and someone will come down."
                  : accessType === "lockbox"
                    ? "e.g. Lockbox is on the railing left of the blue door."
                    : "e.g. Keypad is on the right-hand door frame. Press # after the code."
              }
              aria-label="Entry instructions"
              rows={3}
              className="w-full mt-3 px-4 py-3 rounded-xl font-body text-[14.5px] outline-none resize-none text-navy"
              style={{ border: "1px solid #DCE7F2" }}
            />
            <p className="font-body font-normal text-[13.5px] mt-2 text-ink-faint">
              Shared with the practitioner shortly before their session, never publicly.
            </p>
          </div>
        )}
        {step === 2 && (
          <div className="card-in">
            <SectionLabel>Photos &amp; video</SectionLabel>
            <div className="grid grid-cols-3 gap-2.5">
              {media.map((item) => (
                <MediaTile key={item.id} item={item} onRemove={() => removeMedia(item)} />
              ))}
              {media.length < MAX_MEDIA && (
                <AddMediaTile label={media.length === 0 ? "Cover" : "Add"} onPick={addMedia} />
              )}
            </div>
            <p className="font-body font-normal text-[13.5px] mt-2 text-ink-faint">
              At least one photo or video to continue — up to {MAX_MEDIA}, mixed freely.
            </p>
            <SectionLabel className="mt-6">About this room</SectionLabel>
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value.slice(0, 1200))}
              rows={4}
              placeholder="What it's like to work in. Light, floor, quiet, anything a practitioner would want to picture."
              className="font-body text-[15px] outline-none w-full rounded-xl px-3.5 py-3 resize-none text-navy"
              style={{ border: "1px solid #DCE7F2" }}
            />
            {/*
              The count counts up to the floor rather than down from the cap.
              What stops somebody advancing is the minimum, so that is the
              number worth showing; 1200 is a limit nobody reaches.
            */}
            <p className="font-body font-normal text-[13.5px] mt-1.5 text-ink-faint">
              {describesTheRoom(description)
                ? `${description.length}/1200`
                : `${description.trim().length} of ${MIN_DESCRIPTION_CHARS} characters — a sentence is enough`}
            </p>
            {/*
              Grouped, because a host ticking "reformers" and a host ticking
              "natural light" are answering two different questions — what a
              practitioner will find waiting for them, and what the room is
              like around it. Twenty chips in one heap is a list nobody reads
              to the end of.
            */}
            {AMENITY_GROUPS.map((group) => (
              <div key={group.group}>
                <SectionLabel className="mt-6">
                  {group.heading} <OptionalTag />
                </SectionLabel>
                <div className="flex flex-wrap gap-2">
                  {amenitiesIn(group.group).map((amenity) => (
                    <Chip
                      key={amenity.key}
                      active={amenities.includes(amenity.key)}
                      onClick={() =>
                        setAmenities((list) =>
                          list.includes(amenity.key)
                            ? list.filter((a) => a !== amenity.key)
                            : [...list, amenity.key],
                        )
                      }
                    >
                      {amenity.label}
                    </Chip>
                  ))}
                </div>
              </div>
            ))}
            {/*
              Whether the room is theirs for the hour. Straight after the
              price, this is what somebody seeing one client at a time wants
              to know, and nothing here said it.
            */}
            <SectionLabel className="mt-6">Room setup</SectionLabel>
            <div className="flex flex-col gap-2">
              {ROOM_SETUPS.map((setup) => (
                <button
                  key={setup.key}
                  type="button"
                  onClick={() => setRoomSetup(setup.key)}
                  className="rounded-2xl px-4 py-3 text-left press"
                  style={
                    roomSetup === setup.key
                      ? { backgroundColor: "#EAF4FD", border: "1px solid #2578C2" }
                      : { border: "1px solid #DCE7F2" }
                  }
                >
                  <span className="block font-body font-medium text-[15px] text-navy">
                    {setup.label}
                  </span>
                  <span className="block font-body font-normal text-[13.5px] text-ink-soft mt-0.5">
                    {setup.detail}
                  </span>
                </button>
              ))}
            </div>
            <FieldLabel className="mt-5">
              Floor area <OptionalTag />
            </FieldLabel>
            <div className="flex items-center gap-2">
              <input
                value={floorArea}
                onChange={(event) => setFloorArea(event.target.value.replace(/[^\d]/g, "").slice(0, 5))}
                inputMode="numeric"
                placeholder="e.g. 450"
                className="font-body text-[15px] outline-none rounded-xl px-3.5 py-3 w-full text-navy"
                style={{ border: "1px solid #DCE7F2" }}
              />
              <span className="font-body font-normal text-[15px] shrink-0 text-ink-soft">sq ft</span>
            </div>
            {/*
              Optional, and left blank rather than guessed. Capacity is a
              judgement — a room that seats twelve for meditation seats four
              for movement — and this is the fact underneath it. An invented
              measurement is worse than a missing one, because somebody would
              plan a class around it.
            */}
            <p className="font-body font-normal text-[13.5px] mt-1.5 text-ink-faint">
              The usable floor, if you know it. Leave blank rather than guess.
            </p>
            <SectionLabel className="mt-6">Parking</SectionLabel>
            <p className="font-body font-normal text-[13.5px] mb-3 text-ink-faint">
              Pick everything that applies — a room can have its own spaces and a street anybody
              can use.
            </p>
            <div className="flex flex-wrap gap-2">
              {PARKING_OPTIONS.map((option) => (
                <Chip
                  key={option.key}
                  active={parking.includes(option.key)}
                  onClick={() =>
                    setParking((list) => {
                      if (list.includes(option.key)) {
                        return list.filter((k) => k !== option.key);
                      }
                      /*
                       * "No parking" is not one answer among several — it is
                       * the absence of the others, and a listing claiming both
                       * a private lot and no parking tells nobody anything.
                       */
                      return option.key === "none" ? ["none"] : [...list.filter((k) => k !== "none"), option.key];
                    })
                  }
                >
                  {option.label}
                </Chip>
              ))}
            </div>
            {parking.length > 0 && !parking.includes("none") && (
              <>
                <FieldLabel className="mt-5">How long can a car stay?</FieldLabel>
                <div className="flex flex-wrap gap-2">
                  <Chip active={parkingLimit === null} onClick={() => setParkingLimit(null)}>
                    No limit
                  </Chip>
                  {PARKING_LIMIT_OPTIONS.map((minutes) => (
                    <Chip
                      key={minutes}
                      active={parkingLimit === minutes}
                      onClick={() => setParkingLimit(minutes)}
                    >
                      {minutes < 60 ? `${minutes} min` : `${minutes / 60} hr`}
                    </Chip>
                  ))}
                </div>
                {/*
                  Said to the host at the moment they pick it, because they are
                  the only one who can do anything about it — and because a
                  limit shorter than the session is the kind of detail that
                  looks harmless until somebody is walking out mid-class.
                */}
                {parkingLimit !== null && parkingLimit < 75 && (
                  <p className="font-body font-normal text-[13px] mt-2 text-[#8B6C37]">
                    Sessions are an hour. A {parkingLimit < 60 ? `${parkingLimit}-minute` : "1-hour"}{" "}
                    limit means moving the car before it ends — worth saying, and practitioners will
                    see it.
                  </p>
                )}
              </>
            )}
            {/*
              The four questions the listing actually shows.
              
              This asked "Wheelchair accessible: yes / no", which is the box the
              four facts were built to replace — and the replacement was only
              ever wired into the edit screen. Hosts answered honestly, into a
              column nothing reads, and every listing created here showed
              "access details not given" while its owner believed they had said.
            */}
            <SectionLabel className="mt-6">Getting in</SectionLabel>
            <p className="font-body font-normal text-[13.5px] mb-3 text-ink-faint">
              Each one is a tap. Somebody who needs a step-free way in cannot act on
              &ldquo;accessible&rdquo;, and a shallow step at the door is neither yes nor no.
            </p>
            <AccessEditor details={access} onChange={setAccess} />
            <FieldLabel className="mt-4">
              Restroom <OptionalTag />
            </FieldLabel>
            <div className="flex gap-2">
              {RESTROOM_OPTIONS.map((option) => (
                <Chip key={option} active={restroom === option} onClick={() => setRestroom(option)}>
                  {option === "Private" && <Bath size={12} />}
                  {option}
                </Chip>
              ))}
            </div>
            {/*
              House rules go on step 2 with the rest of the listing detail, and
              they surface on the listing itself rather than in a confirmation
              email. A grip-socks requirement learned on arrival is the same
              broken promise as a fee that appears at checkout.
            */}
            <SectionLabel className="mt-6">
              House rules <OptionalTag />
            </SectionLabel>
            <p className="font-body font-normal text-[13.5px] mb-3 text-ink-faint">
              Anything a practitioner needs to know before they book. Shown on your listing, not
              sprung on them afterwards.
            </p>
            {REQUIREMENT_GROUPS.map(({ kind, heading }) => (
              <div key={kind} className="mb-4">
                <FieldLabel>{heading}</FieldLabel>
                <div className="flex flex-wrap gap-2">
                  {REQUIREMENTS.filter((r) => r.kind === kind).map((requirement) => (
                    <Chip
                      key={requirement.key}
                      active={requirements.includes(requirement.key)}
                      onClick={() =>
                        setRequirements((list) =>
                          list.includes(requirement.key)
                            ? list.filter((k) => k !== requirement.key)
                            : [...list, requirement.key],
                        )
                      }
                    >
                      {requirement.label}
                    </Chip>
                  ))}
                </div>
              </div>
            ))}
            <textarea
              value={houseRules}
              onChange={(e) => setHouseRules(e.target.value)}
              placeholder="Anything else specific to your space"
              aria-label="Other house rules"
              rows={3}
              maxLength={500}
              className="w-full px-4 py-3 rounded-xl font-body text-[14.5px] outline-none resize-none text-navy"
              style={{ border: "1px solid #DCE7F2" }}
            />
            <p className="font-body font-normal text-[13.5px] mt-2 text-ink-faint">
              For what is genuinely particular to your room. Rules must be about the space and how
              it is used — not about who may use it.
            </p>
            <SectionLabel className="mt-6">
              Availability <OptionalTag />
            </SectionLabel>
            <p className="font-body font-normal text-[13.5px] mb-3 text-ink-faint">
              Turn on the days you&apos;re open. Each day can hold several separate blocks, so you
              can keep the gaps for your own use. Times are{" "}
              {zoneAbbreviation(new Date(), timeZone)}, taken from your address — a practitioner
              somewhere else sees these hours converted to theirs.
            </p>
            <WeekSchedule blocks={blocks} onChange={setBlocks} />
            <FieldLabel className="mt-5">
              Turnover time between bookings <OptionalTag />
            </FieldLabel>
            <div className="flex gap-2">
              {BUFFER_OPTIONS.map((minutes) => (
                <Chip
                  key={minutes}
                  active={bufferMinutes === minutes}
                  onClick={() => setBufferMinutes(minutes)}
                >
                  {minutes !== 0 && <Timer size={12} />}
                  {formatBuffer(minutes)}
                </Chip>
              ))}
            </div>
          </div>
        )}
        {step === 3 && (
          <div className="card-in">
            <SectionLabel>Verify your space</SectionLabel>
            <div className="flex flex-col gap-3">
              <DocumentUpload
                label="Proof you can sublease"
                hint="Lease clause, landlord letter, or deed"
                required
                file={subleaseDoc}
                onPick={setSubleaseDoc}
                onRemove={() => setSubleaseDoc(null)}
              />
              <DocumentUpload
                label="Space insurance certificate"
                hint="PDF or photo"
                file={insuranceDoc}
                onPick={setInsuranceDoc}
                onRemove={() => setInsuranceDoc(null)}
              />
            </div>
            <button
              type="button"
              onClick={() => setAgreed((v) => !v)}
              aria-pressed={agreed}
              className="w-full flex items-start gap-3 mt-6 p-3.5 rounded-2xl text-left press"
              style={{
                backgroundColor: agreed ? "#EDF6FE" : "#F4F8FC",
                border: `1px solid ${agreed ? "#D4E8FA" : "#E7EEF6"}`,
              }}
            >
              <span
                className="w-5 h-5 rounded-md flex items-center justify-center shrink-0 mt-0.5"
                style={{
                  backgroundColor: agreed ? "#3B9BE8" : "#fff",
                  border: `1px solid ${agreed ? "#3B9BE8" : "#DCE7F2"}`,
                }}
              >
                {agreed && <Check size={12} color="#fff" />}
              </span>
              <span className="font-body font-normal text-[14px] leading-relaxed text-[#2E5578]">
                <ShieldCheck size={12} className="inline mr-1 -mt-0.5" color="#3B9BE8" />
                This space is legally available for paid wellness sessions, and I&apos;m responsible
                for anything damaged during a booking.
              </span>
            </button>
            <div
              className="mt-5 rounded-2xl p-4"
              style={{ backgroundColor: "#F9FAFB", border: "1px solid #E7EEF6" }}
            >
              <p className="font-body font-medium text-[13.5px] uppercase tracking-wide mb-2 text-ink-faint">
                You&apos;re about to list
              </p>
              <p className="font-body font-medium text-[14.5px] text-navy">
                {name.trim() || "Untitled space"}
              </p>
              <p className="font-body font-normal text-[14px] mt-0.5 text-ink-soft">
                {CATEGORIES.find((c) => c.key === category)?.roomType} · fits {capacity || "?"}
              </p>
              <div className="h-px my-3" style={{ backgroundColor: "#E7EEF6" }} />
              <div className="flex items-center justify-between">
                <span className="font-body text-[14px] text-ink-soft">You keep</span>
                <span className="font-body font-semibold text-[16.5px] text-navy">
                  {formatCents(rateCents || 0)}/hr
                </span>
              </div>
              <div className="flex items-center justify-between mt-1">
                <span className="font-body text-[14px] text-ink-soft">Practitioners see</span>
                <span className="font-body text-[14px] text-ink-faint">
                  {rateIsNumber
                    ? formatCents(
                        quote({
                          hostRateCents: rateCents,
                          isInstant: false,
                          isPro: false,
                        }).totalCents,
                      )
                    : "—"}
                  /hr
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
      <div className="px-6 pt-3 pb-6 shrink-0" style={{ borderTop: "1px solid #F0ECE0" }}>
        {submitError && (
          <div
            className="flex items-start gap-2 mb-3 px-3.5 py-3 rounded-xl"
            style={{ backgroundColor: "#FEF2F0", border: "1px solid #F6D5D0" }}
          >
            <AlertTriangle size={13} color="#C4503F" className="mt-0.5 shrink-0" />
            <p className="font-body font-normal text-[14px] leading-relaxed"
              style={{ color: "#C4503F" }}>
              {submitError}
            </p>
          </div>
        )}
        {!canAdvance && !submitting && missing.length > 0 && (
          <p className="font-body font-normal text-[13.5px] mb-2.5 text-ink-faint">
            Still needs {missing.length === 1 ? missing[0] : `${missing.slice(0, -1).join(", ")} and ${missing.at(-1)}`}.
          </p>
        )}
        <PrimaryButton
          disabled={!canAdvance || submitting}
          onClick={() => {
            if (step < 3) setStep(step + 1);
            else void submit();
          }}
        >
          {step === 3 ? (submitting ? "Listing…" : "List this space") : "Continue"}
        </PrimaryButton>
      </div>
    </div>
  );
}
/* ------------------------------------------------------------------ */
function SectionLabel({
  children,
  className = "",
  id,
}: {
  children: React.ReactNode;
  className?: string;
  /** So a group of chips below can name itself after this heading. */
  id?: string;
}) {
  return (
    <p
      id={id}
      className={`font-body font-semibold text-[12px] uppercase tracking-[0.2em] mb-2 text-sky-text ${className}`}
    >
      {children}
    </p>
  );
}
function FieldLabel({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <p className={`font-body text-[13.5px] mb-1.5 text-ink-soft ${className}`}>{children}</p>
  );
}
function OptionalTag() {
  return <span className="normal-case font-normal text-ink-faint">— optional</span>;
}
function TextInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      aria-label={placeholder}
      className="w-full px-4 py-3 rounded-xl font-body text-[14.5px] outline-none text-navy"
      style={{ border: "1px solid #DCE7F2" }}
    />
  );
}
function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full font-body text-[13.5px] press"
      style={{
        backgroundColor: active ? "#3B9BE8" : "#FFFFFF",
        color: active ? "#fff" : "#16304E",
        border: `1px solid ${active ? "#3B9BE8" : "#DCE7F2"}`,
      }}
    >
      {children}
    </button>
  );
}
