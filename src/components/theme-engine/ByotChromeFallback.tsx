/**
 * Neutral navigation fallback for BYOT themes that ship no chrome.
 *
 * Phase 0 blocker fix: 10 of the 16 V3 themes register no header/footer/cart
 * sections, and the host suppresses its own platform chrome for BYOT bundles —
 * so those stores render with no navigation and no path to the cart. The
 * layout renders this fallback ONLY when `byotProvidesOwnChrome()` is false
 * (see `resolve-theme.ts`), i.e. never for a theme that has its own chrome, so
 * it can't double up on the six chrome-carrying themes.
 *
 * Deliberately minimal and visually neutral: a store-name home link, the
 * top-level menu (best-effort from the already-fetched store menus), and a
 * cart link. Server component, inline styles (no Tailwind-purge dependency),
 * no client JS. This guarantees navigability; a design-consistent per-theme
 * header remains the recommended long-term fix.
 */

type NavItem = {
  label?: { en?: string; ar?: string } | string | null;
  url?: string | null;
};

function labelText(item: NavItem, isAr: boolean): string {
  const l = item.label;
  if (!l) return "";
  if (typeof l === "string") return l;
  return (isAr ? l.ar : l.en) || l.en || l.ar || "";
}

/** Pick the first non-empty menu array from the `{ handle: items[] }` map. */
function pickMenu(navigation: Record<string, unknown[]> | null | undefined): NavItem[] {
  if (!navigation || typeof navigation !== "object") return [];
  for (const value of Object.values(navigation)) {
    if (Array.isArray(value) && value.length > 0) {
      return value.filter(
        (i): i is NavItem => !!i && typeof i === "object",
      );
    }
  }
  return [];
}

export function ByotChromeFallback({
  part,
  storeName,
  navigation,
  locale,
}: {
  part: "header" | "footer";
  storeName: string;
  navigation: Record<string, unknown[]> | null | undefined;
  locale: "ar" | "en";
}) {
  const isAr = locale === "ar";
  const dir = isAr ? "rtl" : "ltr";

  if (part === "footer") {
    const year = new Date().getFullYear();
    return (
      <footer
        dir={dir}
        style={{
          borderTop: "1px solid rgba(0,0,0,0.1)",
          padding: "24px 20px",
          marginTop: "48px",
          fontSize: "14px",
          color: "#555",
          textAlign: "center",
        }}
      >
        <span>
          © {year} {storeName}
        </span>
      </footer>
    );
  }

  const items = pickMenu(navigation)
    .map((i) => ({ text: labelText(i, isAr), url: i.url }))
    .filter((i) => i.text && i.url)
    .slice(0, 6);
  const cartLabel = isAr ? "السلة" : "Cart";

  return (
    <header
      dir={dir}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "20px",
        flexWrap: "wrap",
        padding: "14px 20px",
        borderBottom: "1px solid rgba(0,0,0,0.1)",
        background: "#fff",
        color: "#111",
      }}
    >
      <a
        href="/"
        style={{
          fontWeight: 700,
          fontSize: "18px",
          color: "inherit",
          textDecoration: "none",
          marginInlineEnd: "auto",
        }}
      >
        {storeName}
      </a>
      {items.length > 0 && (
        <nav
          aria-label={isAr ? "التنقل الرئيسي" : "Primary"}
          style={{ display: "flex", gap: "16px", flexWrap: "wrap" }}
        >
          {items.map((i, idx) => (
            <a
              key={idx}
              href={i.url as string}
              style={{ color: "inherit", textDecoration: "none", fontSize: "15px" }}
            >
              {i.text}
            </a>
          ))}
        </nav>
      )}
      <a
        href="/cart"
        style={{ color: "inherit", textDecoration: "none", fontSize: "15px", fontWeight: 600 }}
      >
        {cartLabel}
      </a>
    </header>
  );
}
