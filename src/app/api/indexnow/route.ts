/**
 * POST /api/indexnow — tell search engines a URL changed, now.
 *
 * WHY THIS EXISTS
 * Nothing in the platform proactively tells a search engine that a product,
 * page or article changed; we wait for a crawl. IndexNow turns that into a
 * single POST that Bing, DuckDuckGo, Yandex and Seznam act on within minutes —
 * and Bing's index is what feeds ChatGPT Search, so this is the shortest path
 * from "merchant hit Publish" to "an answer engine can cite the new page".
 *
 * WHO CALLS IT
 * NUMU-api's `nextjs_revalidation.py`, immediately after the storefront cache
 * bust it already performs on publish. Same auth as `/api/revalidate`: the
 * shared secret travels in the `x-revalidation-secret` header, never in the
 * body, so it can't leak into proxy access logs.
 *
 * THE KEY PAIRING (this is the whole verification mechanism)
 * IndexNow proves you own a host by asking you to serve a file whose NAME is
 * the key and whose CONTENT is the same key:
 *
 *     public/<key>.txt   →   https://<store>.numueg.app/<key>.txt
 *
 * The value we submit as `key` is read from `NUMU_INDEXNOW_KEY` at runtime, and
 * it MUST equal the basename of that static file. If the two ever drift — the
 * env var rotated without renaming the file, or vice versa — IndexNow answers
 * 403 "key not valid" and every submission is silently discarded; there is no
 * other channel through which we'd learn about it, which is why the mismatch is
 * logged explicitly below. The file currently in the repo is
 * `public/b9d920e28856ebec9ccfed18d16178d9.txt`, so:
 *
 *     NUMU_INDEXNOW_KEY=b9d920e28856ebec9ccfed18d16178d9
 *
 * Rotating the key means adding the new `<key>.txt` to `public/` and flipping
 * the env var — in that order, so the proof file is live before anything
 * references it. (`public/` is served at the root of every store host: `.txt`
 * bypasses the tenant rewrite in `proxy.ts`, so one file covers all stores.)
 *
 * FAIL-SOFT CONTRACT
 * A marketing ping must never fail a merchant's publish. Every condition that
 * isn't a caller bug — key not configured, store not resolvable, store opted
 * out of indexing, IndexNow down or rate-limiting us — returns 200 with a
 * `submitted: false` + reason payload rather than an error status. Only a bad
 * secret (401) and a malformed body (400) are refused outright.
 */

import { NextRequest, NextResponse } from "next/server";
import { fetchStoreByDomain } from "@/lib/api-client";
import {
  canonicalOriginFor,
  resolveStoreDomainFromHeaders,
  storeBlocksIndexing,
  type StoreForSeo,
} from "@/lib/seo";

// Read at module load, mirroring `/api/revalidate` exactly — including the
// deliberate absence of a default: an empty secret would let an
// unauthenticated POST submit URLs under our IndexNow key.
const SECRET = process.env.REVALIDATION_SECRET ?? "";
const isProd = process.env.NODE_ENV === "production";

/** Must match the basename of the `<key>.txt` file in `public/`. See above. */
const INDEXNOW_KEY = (process.env.NUMU_INDEXNOW_KEY ?? "").trim();

/** The shared IndexNow endpoint — it fans a submission out to every
 *  participating engine, so one POST covers Bing/DDG/Yandex/Seznam. */
const INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow";

/** IndexNow's documented per-request ceiling. Anything beyond it is dropped
 *  here rather than by them, so the response says honestly what was sent. */
const MAX_URLS = 10_000;

/** A publish must not wait on a third party. 5s matches the timeout the
 *  backend already applies to its own revalidation POST. */
const SUBMIT_TIMEOUT_MS = 5_000;

if (isProd && !SECRET) {
  console.error(
    "[indexnow] REVALIDATION_SECRET is not set in production. " +
      "All IndexNow submissions will be rejected.",
  );
}

interface IndexNowBody {
  urls?: unknown;
}

interface HostSubmission {
  host: string;
  urls: string[];
  status?: number;
  ok: boolean;
  error?: string;
}

/**
 * The hostnames this request is allowed to submit for.
 *
 * An IndexNow submission naming someone else's host is an abuse vector: our
 * key would be vouching for URLs we don't serve, which at best gets the key
 * revoked and at worst makes NUMU the vehicle for poisoning a competitor's
 * index. So the allow-set is derived entirely from the store the request
 * actually arrived for — never from the body.
 *
 * Two entries, both store-scoped:
 *   - the host the request came in on (`x-numu-host` › `Host`), which for the
 *     backend caller is `<subdomain>.numueg.app`;
 *   - the store's canonical origin, which is the VERIFIED custom domain when
 *     the merchant has one (see `verifiedCustomHost` in seo.ts — an unverified
 *     `custom_domain` is deliberately not trusted anywhere).
 */
function allowedHostsFor(
  store: StoreForSeo | null,
  domain: string,
  requestHost: string,
): Set<string> {
  const hosts = new Set<string>();
  const add = (value: string | null | undefined): void => {
    const host = (value ?? "").trim().toLowerCase().split(":")[0];
    if (host) hosts.add(host);
  };
  add(requestHost);
  try {
    add(new URL(canonicalOriginFor(store, domain)).hostname);
  } catch {
    // canonicalOriginFor always returns a parseable origin; guard anyway so a
    // future change there can't take the whole endpoint down.
  }
  return hosts;
}

/**
 * Normalise one submitted entry to an absolute URL on a store-owned host, or
 * null if it isn't one.
 *
 * A leading-slash path is resolved against the store's canonical origin — that
 * form CANNOT name a foreign host, and it spares the backend from having to
 * reconstruct the storefront's origin (which would drift the moment a merchant
 * verifies a custom domain). An absolute URL is accepted only when its
 * hostname is in the allow-set.
 */
function normalizeUrl(
  raw: string,
  origin: string,
  allowed: Set<string>,
): string | null {
  const value = raw.trim();
  if (!value) return null;
  // A protocol-relative `//host/path` is never something a caller means here,
  // and neither reading is right: concatenated onto the origin it becomes a
  // junk `https://store//host/path` we'd waste quota submitting, and resolved
  // as a URL it names a foreign host. Drop it so the rejection is visible in
  // the response instead of silently mangled.
  if (value.startsWith("//")) return null;
  try {
    const url = value.startsWith("/")
      ? new URL(`${origin}${value}`)
      : new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (!allowed.has(url.hostname.toLowerCase())) return null;
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * Hosts IndexNow cannot possibly fetch the key file from. Submitting a dev
 * host is a guaranteed 403/422 that would fill the logs with failures nobody
 * can act on, so they're reported as skipped instead. Keyed off the hostname
 * rather than an env flag so a misconfigured NEXT_PUBLIC_NUMU_ENV can't cause
 * localhost URLs to be posted to a public API.
 */
function isPubliclyResolvable(host: string): boolean {
  const h = host.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost")) return false;
  if (h === "127.0.0.1" || h === "::1" || h === "0.0.0.0") return false;
  // No dot at all = a bare internal name (docker service, k8s short name).
  return h.includes(".");
}

async function submitToIndexNow(
  host: string,
  urls: string[],
): Promise<HostSubmission> {
  const submission: HostSubmission = { host, urls, ok: false };
  // Every URL in a submission shares its host with `host`/`keyLocation` — that
  // is IndexNow's own constraint, which is why callers are grouped by host
  // rather than posted in one batch.
  const protocol = urls[0]?.startsWith("http://") ? "http" : "https";
  try {
    const res = await fetch(INDEXNOW_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        host,
        key: INDEXNOW_KEY,
        keyLocation: `${protocol}://${host}/${INDEXNOW_KEY}.txt`,
        urlList: urls,
      }),
      signal: AbortSignal.timeout(SUBMIT_TIMEOUT_MS),
      // Never let this land in the Data Cache — it is a write, and a cached
      // "success" would make a later failure invisible.
      cache: "no-store",
    });
    submission.status = res.status;
    // 200 = accepted, 202 = accepted but key still being validated.
    submission.ok = res.status === 200 || res.status === 202;
    if (!submission.ok) {
      const detail = (await res.text().catch(() => "")).slice(0, 200);
      submission.error = `http_${res.status}${detail ? `: ${detail}` : ""}`;
      // 403 is the key-pairing failure specifically — call it by name so the
      // fix (env value vs `public/<key>.txt` basename) is obvious in the log.
      console.warn(
        res.status === 403
          ? `[indexnow] 403 for ${host} — NUMU_INDEXNOW_KEY does not match a served /<key>.txt`
          : `[indexnow] submission failed for ${host}: ${submission.error}`,
      );
    }
  } catch (err) {
    submission.error = err instanceof Error ? err.message : String(err);
    console.warn(`[indexnow] submission error for ${host}:`, err);
  }
  return submission;
}

export async function POST(request: NextRequest) {
  // Auth, byte-for-byte the scheme `/api/revalidate` uses.
  if (isProd && !SECRET) {
    return NextResponse.json(
      { error: "IndexNow not configured" },
      { status: 503 },
    );
  }
  const provided = request.headers.get("x-revalidation-secret") ?? "";
  // Constant-time-ish compare: we don't ship a crypto dep just for this, but
  // we always compare the configured length to defeat trivial timing probes.
  if (!SECRET || provided.length !== SECRET.length || provided !== SECRET) {
    return NextResponse.json({ error: "Invalid secret" }, { status: 401 });
  }

  let body: IndexNowBody;
  try {
    body = (await request.json()) as IndexNowBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (
    !Array.isArray(body.urls) ||
    body.urls.length === 0 ||
    !body.urls.every((u) => typeof u === "string")
  ) {
    return NextResponse.json(
      { error: "Provide a non-empty `urls` array of strings" },
      { status: 400 },
    );
  }
  const requested = body.urls as string[];

  if (!INDEXNOW_KEY) {
    // Not an error state: a platform that hasn't enabled IndexNow yet should
    // publish exactly as before. Warn once per call so the gap is visible.
    console.warn(
      "[indexnow] NUMU_INDEXNOW_KEY is not set — submissions are disabled. " +
        "Set it to the basename of the <key>.txt file in public/.",
    );
    return NextResponse.json({
      submitted: false,
      reason: "indexnow_key_not_configured",
      requested: requested.length,
    });
  }

  const requestHost = (
    request.headers.get("x-numu-host") ||
    request.headers.get("host") ||
    ""
  )
    .trim()
    .toLowerCase()
    .split(":")[0];
  const domain = resolveStoreDomainFromHeaders(request.headers);
  if (!domain) {
    return NextResponse.json({
      submitted: false,
      reason: "store_not_resolvable",
      requested: requested.length,
    });
  }

  let store: StoreForSeo | null = null;
  try {
    store = (await fetchStoreByDomain(domain)) as unknown as StoreForSeo;
  } catch (err) {
    console.warn("[indexnow] store resolution failed", { domain, err });
    return NextResponse.json({
      submitted: false,
      reason: "store_not_resolvable",
      requested: requested.length,
    });
  }

  // Never announce a store that told crawlers to stay away.
  if (storeBlocksIndexing(store)) {
    return NextResponse.json({
      submitted: false,
      reason: "store_blocks_indexing",
      requested: requested.length,
    });
  }

  const origin = canonicalOriginFor(store, domain);
  const allowed = allowedHostsFor(store, domain, requestHost);

  const accepted = new Set<string>();
  const rejected: string[] = [];
  for (const raw of requested) {
    if (accepted.size >= MAX_URLS) break;
    const normalized = normalizeUrl(raw, origin, allowed);
    if (normalized) accepted.add(normalized);
    else rejected.push(raw);
  }
  if (rejected.length > 0) {
    // Loud on purpose — a foreign host here is either a caller bug or an abuse
    // attempt, and both need a name attached.
    console.warn(
      `[indexnow] rejected ${rejected.length} url(s) not on ${[...allowed].join(", ")}:`,
      rejected.slice(0, 10),
    );
  }
  if (accepted.size === 0) {
    return NextResponse.json({
      submitted: false,
      reason: "no_eligible_urls",
      requested: requested.length,
      rejected: rejected.length,
    });
  }

  // IndexNow requires every URL in one submission to share the host it is sent
  // under, so group first. In practice this is a single host; two only when a
  // caller mixes the subdomain and a verified custom domain.
  const byHost = new Map<string, string[]>();
  const skippedHosts = new Set<string>();
  for (const url of accepted) {
    const host = new URL(url).host;
    if (!isPubliclyResolvable(host.split(":")[0])) {
      skippedHosts.add(host);
      continue;
    }
    const bucket = byHost.get(host);
    if (bucket) bucket.push(url);
    else byHost.set(host, [url]);
  }
  if (byHost.size === 0) {
    return NextResponse.json({
      submitted: false,
      reason: "host_not_publicly_resolvable",
      requested: requested.length,
      hosts: [...skippedHosts],
    });
  }

  const results = await Promise.all(
    [...byHost].map(([host, urls]) => submitToIndexNow(host, urls)),
  );

  return NextResponse.json({
    submitted: results.some((r) => r.ok),
    requested: requested.length,
    accepted: accepted.size,
    rejected: rejected.length,
    ...(skippedHosts.size > 0 ? { skippedHosts: [...skippedHosts] } : {}),
    results: results.map((r) => ({
      host: r.host,
      count: r.urls.length,
      ok: r.ok,
      status: r.status,
      ...(r.error ? { error: r.error } : {}),
    })),
  });
}
