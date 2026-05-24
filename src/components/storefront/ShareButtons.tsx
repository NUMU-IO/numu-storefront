"use client";

/**
 * Customer-share buttons for the built-in PDP.
 *
 * Feature 001 US4 — every outgoing share URL is auto-tagged with:
 *
 *   utm_source=customer_share
 *   utm_medium=<channel>           (whatsapp / facebook / twitter / telegram / copy_link)
 *   utm_campaign=organic_share
 *
 * Recipients clicking the shared link land with these params; the
 * storefront's AttributionProvider captures them on mount, writes the
 * `numu_attribution` cookie, and the eventual order attributes back to
 * "customer_share" as a distinct traffic source in the merchant's
 * traffic-sources report. Per FR-011, `utm_campaign=organic_share`
 * does NOT resolve to any MarketingCampaign, so order.campaign_id
 * stays NULL — viral shares show up cleanly separately from paid
 * campaigns.
 *
 * Bare-bones styling to match the rest of the built-in PDP (no
 * shadcn, no design-system dependencies — the BYOT bundles bring
 * their own UI; the built-in path is the minimum-viable fallback).
 */

import { useEffect, useMemo, useState } from "react";

const UTM_SOURCE = "customer_share";
const UTM_CAMPAIGN = "organic_share";

interface ShareButtonsProps {
  /** Absolute URL or relative path (starting with "/"); empty = use window.location.href. */
  url?: string;
  /** Product or page title for share-platform "text" intent params. */
  title?: string;
  className?: string;
}

function taggedUrl(rawUrl: string, channel: string): string {
  if (!rawUrl) return rawUrl;
  try {
    const u = new URL(rawUrl);
    u.searchParams.set("utm_source", UTM_SOURCE);
    u.searchParams.set("utm_medium", channel);
    u.searchParams.set("utm_campaign", UTM_CAMPAIGN);
    return u.toString();
  } catch {
    return rawUrl;
  }
}

export function ShareButtons({
  url = "",
  title = "",
  className = "",
}: ShareButtonsProps) {
  const [copied, setCopied] = useState(false);
  const [resolved, setResolved] = useState<string>(() =>
    url && /^https?:\/\//i.test(url) ? url : "",
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (url && /^https?:\/\//i.test(url)) {
      setResolved(url);
    } else if (url && url.startsWith("/")) {
      setResolved(`${window.location.origin}${url}`);
    } else {
      setResolved(window.location.href);
    }
  }, [url]);

  const links = useMemo(() => {
    const encodedTitle = encodeURIComponent(title);
    return {
      whatsapp: `https://wa.me/?text=${encodedTitle}%20${encodeURIComponent(
        taggedUrl(resolved, "whatsapp"),
      )}`,
      facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(
        taggedUrl(resolved, "facebook"),
      )}`,
      twitter: `https://twitter.com/intent/tweet?url=${encodeURIComponent(
        taggedUrl(resolved, "twitter"),
      )}&text=${encodedTitle}`,
      telegram: `https://t.me/share/url?url=${encodeURIComponent(
        taggedUrl(resolved, "telegram"),
      )}&text=${encodedTitle}`,
    };
  }, [resolved, title]);

  const handleCopy = async () => {
    const target = taggedUrl(
      resolved || (typeof window !== "undefined" ? window.location.href : ""),
      "copy_link",
    );
    try {
      await navigator.clipboard.writeText(target);
    } catch {
      /* clipboard unavailable — feedback only */
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const btn =
    "w-9 h-9 rounded-full border border-gray-300 flex items-center justify-center text-gray-600 hover:border-gray-900 hover:text-gray-900 transition";

  return (
    <div className={`flex items-center gap-2 ${className}`} aria-label="Share">
      <span className="text-sm text-gray-500 mr-1">Share:</span>

      <a
        href={links.whatsapp}
        target="_blank"
        rel="noopener noreferrer"
        className={btn}
        aria-label="Share on WhatsApp"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
        </svg>
      </a>

      <a
        href={links.facebook}
        target="_blank"
        rel="noopener noreferrer"
        className={btn}
        aria-label="Share on Facebook"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
          <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
        </svg>
      </a>

      <a
        href={links.twitter}
        target="_blank"
        rel="noopener noreferrer"
        className={btn}
        aria-label="Share on X"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
        </svg>
      </a>

      <a
        href={links.telegram}
        target="_blank"
        rel="noopener noreferrer"
        className={btn}
        aria-label="Share on Telegram"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
          <path d="M11.944 0A12 12 0 000 12a12 12 0 0012 12 12 12 0 0012-12A12 12 0 0012 0a12 12 0 00-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 01.171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
        </svg>
      </a>

      <button
        type="button"
        onClick={handleCopy}
        className={btn}
        aria-label="Copy link"
      >
        {copied ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
          </svg>
        )}
      </button>
    </div>
  );
}
