import { setOptions, importLibrary } from "@googlemaps/js-api-loader";

let configured = false;
let mapsReady: Promise<void> | null = null;

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

function configure() {
  if (configured) return;
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY;
  if (!apiKey) {
    throw new Error("NEXT_PUBLIC_GOOGLE_MAPS_KEY is not set");
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
 * Rejects (rather than throwing synchronously) when the key is missing OR
 * the Google script fails to load. Callers MUST `.catch()` and degrade to
 * manual entry — the picker must never crash the checkout.
 */
export function loadGoogleMaps(): Promise<void> {
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
