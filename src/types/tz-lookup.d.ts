/** `tz-lookup` ships no types; this is its whole surface. */
declare module "tz-lookup" {
  /** IANA zone covering a point. Throws if the coordinates are out of range. */
  export default function tzLookup(lat: number, lng: number): string;
}
