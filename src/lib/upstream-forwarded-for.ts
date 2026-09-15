import type { NextRequest } from "next/server";

/**
 * The shopper's `X-Forwarded-For` chain to hand to the backend.
 *
 * `fetch` from a route handler is server-to-server, so NONE of the shopper's
 * request headers travel with it. Without this header the backend sees every
 * shopper as this server's address:
 * - per-IP rate limits (guest order lookup, newsletter signup) collapse into
 *   ONE bucket shared by every shopper on the instance, so a single abuser
 *   takes the feature down platform-wide;
 * - CAPI `client_ip_address` carries one uniformly wrong IP, which degrades
 *   Meta / TikTok match quality instead of merely failing to help it.
 *
 * We APPEND to the incoming chain rather than replacing it, so the hops that
 * already handled this request stay visible to the backend. `cf-connecting-ip`
 * is the edge's own view of the shopper and is preferred as the value to
 * contribute; it is normally already the head of the chain, hence the
 * duplicate check. When there is no chain at all (direct hit, local dev) the
 * single value becomes the whole header.
 *
 * This is a fairness fix, not authentication — the leftmost entry is still
 * whatever the shopper's own client claimed.
 */
export function upstreamForwardedFor(req: NextRequest): string | null {
  const chain = (req.headers.get("x-forwarded-for") || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

  const edgeClientIp =
    req.headers.get("cf-connecting-ip") || req.headers.get("x-real-ip");
  if (edgeClientIp && !chain.includes(edgeClientIp)) {
    chain.push(edgeClientIp);
  }

  return chain.length > 0 ? chain.join(", ") : null;
}
