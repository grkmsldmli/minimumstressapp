import Link from "next/link";

import { APP_URL } from "@/lib/company";
import { listingPath } from "@/lib/listing-url";
import type { DirectorySpace } from "@/lib/directory-data";
import { formatCents } from "@/lib/money";
import { spaceTypeBySlug } from "@/lib/space-types";
import { roomTypeFor, type CategoryKey } from "@/lib/taxonomy";

/**
 * The rooms on a directory page, as text a crawler can read.
 *
 * Deliberately not the app's card component. That one is a client component
 * built around a map, a photograph and a tap target; this is a server-rendered
 * list whose entire job is that the name, the price, the town and what the
 * room suits are in the HTML without JavaScript running. A page whose content
 * only exists after hydration is a page a crawler reads as empty, and these
 * pages have no other purpose.
 */
export function SpaceCards({ spaces }: { spaces: DirectorySpace[] }) {
  if (spaces.length === 0) {
    return (
      <p className="text-[15px] leading-[1.75]" style={{ color: "#8a94a3" }}>
        Nothing is listed here yet.
      </p>
    );
  }

  return (
    <ul className="space-y-3">
      {spaces.map((space) => {
        const path = listingPath(space);
        const uses = space.suitableFor
          .map(spaceTypeBySlug)
          .flatMap((type) => (type ? [type.label] : []));

        return (
          <li key={space.id} className="rounded-2xl p-5" style={{ border: "1px solid #e7eef6" }}>
            <div className="flex flex-wrap items-baseline justify-between gap-x-4">
              <h3 className="text-[17px]" style={{ color: "#0F2F55" }}>
                {space.name}
              </h3>
              <p className="text-[15px]" style={{ color: "#0F2F55" }}>
                {formatCents(space.hourlyRateCents)}
                <span className="text-[13px]" style={{ color: "#8a94a3" }}> an hour</span>
              </p>
            </div>

            <p className="mt-1 text-[13.5px]" style={{ color: "#8a94a3" }}>
              {roomTypeFor(space.category as CategoryKey)} · {space.area ?? space.city} · fits{" "}
              {space.capacity}
            </p>

            {space.description && (
              <p className="mt-2.5 text-[14.5px] leading-[1.7]" style={{ color: "#5f6673" }}>
                {space.description}
              </p>
            )}

            {uses.length > 0 && (
              <p className="mt-2.5 text-[13.5px]" style={{ color: "#8a94a3" }}>
                Good for {uses.join(" · ")}
              </p>
            )}

            {/*
              To the room's own page, which is how a crawler reaches it and
              how somebody reads the whole listing before deciding. Booking is
              a step further on, in the app.

              A room with no town has no page — it is bookable and simply not
              addressable out here — so that one still links into the app.
            */}
            {path ? (
              <Link href={path} className="mt-4 inline-block text-[14px]" style={{ color: "#0EA5E9" }}>
                See the room →
              </Link>
            ) : (
              <a
                href={`${APP_URL}?space=${encodeURIComponent(space.id)}`}
                className="mt-4 inline-block text-[14px]"
                style={{ color: "#0EA5E9" }}
              >
                See hours and book →
              </a>
            )}
          </li>
        );
      })}
    </ul>
  );
}
