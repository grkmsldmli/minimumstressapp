import { ImageResponse } from "next/og";

/**
 * What a studio owner sees before they see anything else.
 *
 * Recruiting hosts is a link in a message. Without this the link unfurls as a
 * bare URL with no picture and no name, which reads as a half-finished side
 * project — the opposite of what somebody is being asked to trust with their
 * room and their bank details.
 *
 * Drawn rather than uploaded. A designed PNG would be a second place the brand
 * lives, and the one that never gets updated; this is the same navy, the same
 * two typefaces and the same sentence the app opens with, so it cannot drift
 * from the product it is advertising.
 */

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Minimum Stress — private rooms by the hour for every kind of practice";

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 88,
          backgroundColor: "#16304E",
          // The same soft light the splash screen has, so the card and the
          // first screen look like the same company.
          backgroundImage:
            "radial-gradient(1000px 520px at 78% 8%, rgba(59,155,232,0.34), transparent 62%)",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div
            style={{
              fontSize: 27,
              letterSpacing: 15,
              color: "#8CB6E0",
              fontWeight: 500,
            }}
          >
            MINIMUM STRESS
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 26 }}>
          {/*
            Two lines, two elements. The renderer behind this needs an explicit
            display on anything holding more than one child, and it does not
            break on <br /> — a single string with a line break silently failed
            the whole build rather than wrapping.
          */}
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div
              style={{ fontSize: 74, lineHeight: 1.14, color: "#FFFFFF", letterSpacing: -1.5 }}
            >
              Private rooms by the hour,
            </div>
            <div
              style={{ fontSize: 74, lineHeight: 1.14, color: "#FFFFFF", letterSpacing: -1.5 }}
            >
              for every kind of practice.
            </div>
          </div>
          <div style={{ fontSize: 31, color: "#A9C6E4", maxWidth: 860, lineHeight: 1.4 }}>
            Movement, coaching, meditation and healing — booked by the hour, in studios that
            already have the room.
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <div style={{ width: 40, height: 3, backgroundColor: "#3B9BE8", borderRadius: 2 }} />
          <div style={{ fontSize: 27, color: "#8CB6E0" }}>minimumstress.app</div>
        </div>
      </div>
    ),
    size,
  );
}
