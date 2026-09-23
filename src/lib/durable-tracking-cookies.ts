/**
 * Re-issue the tracking cookies from the server on every page navigation.
 *
 * Safari caps cookies written by JavaScript at 7 days, and at 24 hours when
 * the landing URL carries a click id (`?fbclid=`, `?ttclid=`). Every tracking
 * cookie here was written by script, so on Safari a returning shopper lost
 * their visitor id, their Meta browser id and their ad click within a day or
 * a week, and Meta and TikTok saw each visit as a stranger. A cookie set in
 * the store's own HTTP response is not capped, so re-setting the same value
 * here keeps it for its full lifetime and extends it on every visit.
 *
 * Only cookies the browser already holds are refreshed; ids are never minted
 * here, because a server id that disagrees with the browser's is worse than
 * none. The two exceptions are the click ids, which are taken from the
 * landing URL itself so a one-page visit still keeps them.
 */
import type { NextRequest, NextResponse } from "next/server";

const DAY = 24 * 60 * 60;

/** Lifetimes match what the browser code (and the pixels) write. */
const KEEP: Record<string, number> = {
  numu_sid: 180 * DAY,
  numu_attribution: 90 * DAY,
  _fbp: 90 * DAY,
  _fbc: 90 * DAY,
  ttclid: 30 * DAY,
  _ttp: 390 * DAY,
};

/**
 * Meta's subdomain index: labels in the public suffix. Must match the
 * bootstrap in `components/tracking/MetaPixel.tsx`.
 */
function subdomainIndex(host: string): number {
  const suffix = host.split(".").slice(-2).join(".");
  return /^(com|net|org|edu|gov|co|ac|me)\.[a-z]{2}$/.test(suffix) ? 2 : 1;
}

export function keepTrackingCookies(
  req: Pick<NextRequest, "cookies" | "nextUrl" | "headers">,
  res: Pick<NextResponse, "cookies">,
  host: string,
): void {
  const secure =
    req.nextUrl.protocol === "https:" ||
    req.headers.get("x-forwarded-proto") === "https";
  const set = (name: string, value: string) =>
    res.cookies.set(name, value, {
      path: "/",
      maxAge: KEEP[name],
      sameSite: "lax",
      secure,
    });

  const values: Record<string, string> = {};
  for (const name of Object.keys(KEEP)) {
    const value = req.cookies.get(name)?.value;
    if (value) values[name] = value;
  }

  // A new Meta click replaces the stored one; the same click keeps its
  // first-seen time, which Meta reads as the click time.
  const fbclid = req.nextUrl.searchParams.get("fbclid");
  if (fbclid && values._fbc?.split(".").slice(3).join(".") !== fbclid) {
    values._fbc = `fb.${subdomainIndex(host)}.${Date.now()}.${fbclid}`;
  }
  const ttclid = req.nextUrl.searchParams.get("ttclid");
  if (ttclid) values.ttclid = ttclid;

  for (const [name, value] of Object.entries(values)) set(name, value);
}
