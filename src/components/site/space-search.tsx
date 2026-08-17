"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { SPACE_TYPES } from "@/lib/space-types";

/**
 * The two questions a marketplace homepage has to ask.
 *
 * What kind of room, and where. Everything else on this page is explanation;
 * this is the only part that is the product, and putting it in the hero is the
 * difference between a site that describes a marketplace and one that reads
 * as being a marketplace.
 *
 * It is a real search that leads somewhere real, which at the moment means it
 * leads to an honest answer rather than to results — nothing is listed yet,
 * and /spaces says so for the exact town and use that were asked for. That is
 * on purpose. A search box that returned invented rooms, or that quietly did
 * nothing, would be the first promise this page makes and the first one
 * broken. The same box becomes a search over real inventory the day there is
 * some, with nothing here to change.
 */
export function SpaceSearch() {
  const router = useRouter();
  const [type, setType] = useState("");
  const [where, setWhere] = useState("");

  const submit = (event: React.FormEvent) => {
    event.preventDefault();

    const params = new URLSearchParams();
    if (type) params.set("type", type);
    if (where.trim()) params.set("where", where.trim());

    const query = params.toString();
    router.push(query ? `/spaces?${query}` : "/spaces");
  };

  return (
    <form
      onSubmit={submit}
      className="mt-8 rounded-2xl p-4 sm:p-5"
      style={{ backgroundColor: "#ffffff", border: "1px solid #e7eef6", boxShadow: "0 6px 24px rgba(15,47,85,.06)" }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="block text-[11px] uppercase tracking-[0.1em]" style={{ color: "#8a94a3" }}>
            What kind of space?
          </span>
          <select
            value={type}
            onChange={(event) => setType(event.target.value)}
            className="mt-1.5 w-full rounded-xl bg-white px-3.5 py-3 text-[15px] outline-none"
            style={{ border: "1px solid #e7eef6", color: "#0F2F55" }}
          >
            <option value="">Any space</option>
            {SPACE_TYPES.map((space) => (
              <option key={space.slug} value={space.slug}>
                {space.label}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="block text-[11px] uppercase tracking-[0.1em]" style={{ color: "#8a94a3" }}>
            Where?
          </span>
          <input
            value={where}
            onChange={(event) => setWhere(event.target.value)}
            placeholder="San Mateo, CA"
            autoComplete="address-level2"
            className="mt-1.5 w-full rounded-xl bg-white px-3.5 py-3 text-[15px] outline-none"
            style={{ border: "1px solid #e7eef6", color: "#0F2F55" }}
          />
        </label>
      </div>

      <button
        type="submit"
        className="mt-3 w-full rounded-xl px-6 py-3.5 text-[15px] font-medium text-white sm:w-auto sm:px-8"
        style={{ backgroundColor: "#0F2F55" }}
      >
        Find spaces
      </button>
    </form>
  );
}
