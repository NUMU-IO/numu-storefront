import { setOptions, importLibrary } from "@googlemaps/js-api-loader";

let configured = false;
let mapsReady: Promise<void> | null = null;

const UNAVAILABLE_KEY = "numu_maps_unavailable";
const authFailureSubs = new Set<() => void>();
let authFailed = false;

/**
 * True when a Maps key is present in the environment. The picker uses this
 * to decide whether to render at all — with no key, `loadGoogleMaps()`
 * rejects and the checkout degrades to manual address entry.
 *
 * `NEXT_PUBLIC_*` vars are inlined at build time, so this is a static
 * read on the client (no runtime lookup cost, no leak of other env vars).
 */
export function hasGoogleMapsKey(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY);
}

/**
 * True once the Maps JS API has reported an authentication failure this
 * session — an invalid/expired key, a billing problem, or (most common in
 * dev/test) a `RefererNotAllowedMapError` because the page's host isn't in the
 * key's allowed-referrers list. Persisted in sessionStorage so the picker
 * stops re-attempting after the first failure (no repeated Google console
 * errors) and the checkout cleanly falls back to manual address entry.
 */
export function mapsUnavailable(): boolean {
  if (authFailed) return true;
  try {
    return sessionStorage.getItem(UNAVAILABLE_KEY) === "1";
  } catch {
    return false;
  }
}

/** A usable picker can be offered: key present AND no auth failure yet. */
export function canUseMaps(): boolean {
  return hasGoogleMapsKey() && !mapsUnavailable();
}

/** Subscribe to the (first) Maps auth failure. Returns an unsubscribe fn. */
export function onMapsUnavailable(cb: () => void): () => void {
  authFailureSubs.add(cb);
  if (mapsUnavailable()) cb();
  return () => {
    authFailureSubs.delete(cb);
  };
}

function markUnavailable() {
  authFailed = true;
  try {
    sessionStorage.setItem(UNAVAILABLE_KEY, "1");
  } catch {
    /* ignore */
  }
  // Drop the load memo so callers don't get a resolved-but-dead promise.
  mapsReady = null;
  authFailureSubs.forEach((cb) => {
    try {
      cb();
    } catch {
      /* a subscriber must never break the failure path */
    }
  });
}

function configure() {
  if (configured) return;
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY;
  if (!apiKey) {
    throw new Error("NEXT_PUBLIC_GOOGLE_MAPS_KEY is not set");
  }
  // Google invokes this global on ANY Maps auth failure (bad/expired key,
  // billing, RefererNotAllowedMapError) — it's the only programmatic signal,
  // since `importLibrary()` still resolves. Wire it once so the picker can
  // degrade to manual entry instead of showing Google's broken error tile.
  if (typeof window !== "undefined") {
    (window as unknown as { gm_authFailure?: () => void }).gm_authFailure =
      () => markUnavailable();
  }
  setOptions({
    key: apiKey,
    v: "weekly",
    language: "ar",
    region: "EG",
  });
  configured = true;
}

/**
 * Loads the Maps JS API plus the libraries the location picker uses
 * (`maps`, `places`, `geocoding`). Idempotent — repeated calls return
 * the same promise and never re-trigger script loading.
 *
 * Rejects (rather than throwing synchronously) when the key is missing, when
 * a prior auth failure was recorded this session, OR when the Google script
 * fails to load. Callers MUST `.catch()` and degrade to manual entry — the
 * picker must never crash the checkout.
 */
export function loadGoogleMaps(): Promise<void> {
  // Once auth is known-bad this session, don't re-load — re-loading just
  // re-emits the same RefererNotAllowed/auth console error.
  if (mapsUnavailable()) {
    return Promise.reject(new Error("Google Maps unavailable (auth failure)"));
  }
  if (mapsReady) return mapsReady;
  try {
    configure();
  } catch (err) {
    return Promise.reject(err);
  }
  mapsReady = Promise.all([
    importLibrary("maps"),
    importLibrary("places"),
    importLibrary("geocoding"),
  ]).then(() => undefined);
  // If the script fails to load (network/blocked/invalid key), reset the
  // memo so a later retry (e.g. reopening the dialog) can try again.
  mapsReady.catch(() => {
    mapsReady = null;
  });
  return mapsReady;
}
