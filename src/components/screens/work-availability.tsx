"use client";

import { useState } from "react";
import { ArrowLeft, MapPin } from "lucide-react";

import { Ambient, Headline } from "@/components/brand";
import { PrimaryButton, Toggle } from "@/components/primitives";
import type { AvailabilityBlock } from "@/lib/availability";
import { findProblems } from "@/lib/availability";
import type { WorkPreferences, WorkPreferencesInput } from "@/lib/domain";
import { viewerZone, zoneAbbreviation } from "@/lib/timezone";
import { WeekSchedule } from "@/components/week-schedule";
import { GroupLabel } from "./practitioner-extras";

const NAVY = "radial-gradient(140% 120% at 15% 0%, #1E4066 0%, #16304E 85%)";

export function WorkAvailabilityEditor({
  initialBlocks,
  preferences,
  saving,
  onSave,
  onBack,
}: {
  initialBlocks: AvailabilityBlock[];
  preferences: WorkPreferences;
  saving: boolean;
  onSave: (blocks: AvailabilityBlock[], prefs: WorkPreferencesInput) => void;
  onBack: () => void;
}) {
  const [blocks, setBlocks] = useState<AvailabilityBlock[]>(initialBlocks);
  const [radius, setRadius] = useState(
    preferences.maxTravelMiles != null ? String(preferences.maxTravelMiles) : "",
  );
  const [minPay, setMinPay] = useState(
    preferences.minPayCents != null ? String(Math.round(preferences.minPayCents / 100)) : "",
  );
  const [openToOnetime, setOpenToOnetime] = useState(preferences.openToOnetime);
  const [openToRecurring, setOpenToRecurring] = useState(preferences.openToRecurring);
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [locateError, setLocateError] = useState<string | null>(null);

  const problems = findProblems(blocks);
  const zone = viewerZone();
  const zoneLabel = zoneAbbreviation(new Date(), zone);

  const useMyLocation = () => {
    if (!("geolocation" in navigator)) {
      setLocateError("This device can't share a location.");
      return;
    }
    setLocating(true);
    setLocateError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setLocating(false);
      },
      () => {
        setLocateError("We couldn't get your location.");
        setLocating(false);
      },
      { enableHighAccuracy: false, timeout: 8000 },
    );
  };

  const save = () => {
    if (problems.length > 0) return;
    const radiusNum = radius.trim() === "" ? null : Math.round(Number(radius));
    const payNum = minPay.trim() === "" ? null : Math.round(Number(minPay) * 100);
    onSave(blocks, {
      workTimeZone: zone,
      maxTravelMiles: radiusNum != null && Number.isFinite(radiusNum) ? radiusNum : null,
      minPayCents: payNum != null && Number.isFinite(payNum) ? payNum : null,
      openToOnetime,
      openToRecurring,
      ...(location ? { location } : {}),
    });
  };

  return (
    <div className="h-full flex flex-col screen-in bg-white">
      <div
        className="px-6 pt-8 safe-pt-8 pb-7 rounded-b-[30px] relative overflow-hidden shrink-0"
        style={{ background: NAVY }}
      >
        <Ambient />
        <button
          type="button"
          onClick={onBack}
          aria-label="Back"
          className="w-9 h-9 rounded-full flex items-center justify-center press relative z-10"
          style={{ backgroundColor: "rgba(255,255,255,0.14)" }}
        >
          <ArrowLeft size={17} color="#fff" />
        </button>
        <div className="mt-5 relative z-10">
          <Headline pre="When you're" accent="free." size={24} light />
          <p className="font-body font-normal text-[13px] text-white/60 mt-1.5">
            Times are in your zone{zoneLabel ? ` (${zoneLabel})` : ""}. Studios see coverage that
            lands inside these windows.
          </p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 pt-5 pb-8 safe-pb-8">
        <WeekSchedule blocks={blocks} onChange={setBlocks} />

        <div className="mt-7">
          <GroupLabel>Preferences</GroupLabel>

          <div className="rounded-xl bg-white p-3.5 mb-3" style={{ border: "1px solid #E7EEF6" }}>
            <label className="font-body font-medium text-[14px] text-navy">
              Travel distance
              <span className="font-normal text-ink-faint"> (miles)</span>
            </label>
            <input
              value={radius}
              onChange={(e) => setRadius(e.target.value.replace(/[^0-9]/g, ""))}
              inputMode="numeric"
              placeholder="Any distance"
              aria-label="Maximum travel distance in miles"
              className="w-full mt-2 px-4 py-3 rounded-xl font-body text-[15px] text-navy outline-none"
              style={{ border: "1px solid #DCE7F2" }}
            />
          </div>

          <div className="rounded-xl bg-white p-3.5 mb-3" style={{ border: "1px solid #E7EEF6" }}>
            <label className="font-body font-medium text-[14px] text-navy">
              Minimum pay
              <span className="font-normal text-ink-faint"> (per class)</span>
            </label>
            <input
              value={minPay}
              onChange={(e) => setMinPay(e.target.value.replace(/[^0-9]/g, ""))}
              inputMode="numeric"
              placeholder="No minimum"
              aria-label="Minimum acceptable pay in dollars"
              className="w-full mt-2 px-4 py-3 rounded-xl font-body text-[15px] text-navy outline-none"
              style={{ border: "1px solid #DCE7F2" }}
            />
          </div>

          <div
            className="flex items-center justify-between p-3.5 rounded-xl bg-white mb-3"
            style={{ border: "1px solid #E7EEF6" }}
          >
            <div className="pr-3">
              <p className="font-body font-medium text-[14.5px] text-navy">One-time coverage</p>
              <p className="font-body font-normal text-[13px] mt-0.5 text-ink-faint">
                A single class when a studio is short
              </p>
            </div>
            <Toggle on={openToOnetime} onClick={() => setOpenToOnetime((v) => !v)} label="One-time coverage" />
          </div>

          <div
            className="flex items-center justify-between p-3.5 rounded-xl bg-white mb-3"
            style={{ border: "1px solid #E7EEF6" }}
          >
            <div className="pr-3">
              <p className="font-body font-medium text-[14.5px] text-navy">Recurring opportunities</p>
              <p className="font-body font-normal text-[13px] mt-0.5 text-ink-faint">
                Regular slots, not just one-offs
              </p>
            </div>
            <Toggle
              on={openToRecurring}
              onClick={() => setOpenToRecurring((v) => !v)}
              label="Recurring opportunities"
            />
          </div>

          <button
            type="button"
            onClick={useMyLocation}
            disabled={locating}
            className="w-full flex items-center gap-3 p-3.5 rounded-xl press bg-white text-left disabled:opacity-60"
            style={{ border: "1px solid #E7EEF6" }}
          >
            <MapPin size={15} color="#3B9BE8" />
            <span className="flex-1 font-body font-medium text-[14.5px] text-navy">
              {locating
                ? "Getting your location…"
                : location
                  ? "Location updated"
                  : preferences.hasLocation
                    ? "Update work location"
                    : "Set work location for distance"}
            </span>
          </button>
          {locateError && (
            <p className="font-body font-normal text-[12.5px] mt-1.5" style={{ color: "#B45143" }}>
              {locateError}
            </p>
          )}
        </div>

        {problems.length > 0 && (
          <p className="font-body font-normal text-[13px] mt-4" style={{ color: "#B45143" }} role="alert">
            Fix the overlapping or backwards times before saving.
          </p>
        )}
      </div>

      <div className="px-6 pt-3 pb-6 safe-pb-6 shrink-0" style={{ borderTop: "1px solid #F0ECE0" }}>
        <PrimaryButton onClick={save} disabled={saving || problems.length > 0}>
          {saving ? "Saving…" : "Save availability"}
        </PrimaryButton>
      </div>
    </div>
  );
}
