/**
 * PaymentMark — the brand mark beside each payment method at checkout.
 *
 * Replaces the two hand-drawn outlines (`PayIcon`) that used to stand in for
 * every method on the platform: a banknote for COD/Fawry and one generic card
 * for InstaPay, Paymob, Kashier, Moyasar and Fawaterak alike. Two visually
 * identical rows asking the shopper to choose between them is a choice the
 * interface refuses to help with, at the exact step where hesitation costs the
 * order.
 *
 * These are **brand-coloured wordmarks**, not official logo files. That is a
 * deliberate call: shipping third-party logo assets means honouring each
 * brand's usage rules (clear space, no recolouring, no distortion) and keeping
 * them updated, and Vodafone in particular is strict. Wordmarks in the correct
 * brand colour carry the recognition — which is what the shopper is scanning
 * for — at a fraction of the risk, with no extra network request and no raster
 * asset to go stale. Swapping in official SVGs later means editing this one
 * file.
 *
 * Every mark renders into the same 40×26 tile so the rows align down a common
 * edge no matter which methods a store has enabled.
 */

const W = 40;
const H = 26;

/** Collapse a gateway code (or a merchant's free-text label) onto one mark. */
export function markKey(code: string, label?: string): string {
  const k = `${code} ${label ?? ""}`.toLowerCase().replace(/[\s_-]/g, "");
  if (k.includes("instapay") || k.includes("انستاباي") || k.includes("إنستاباي"))
    return "instapay";
  if (k.includes("vodafone") || k.includes("فودافون")) return "vodafone";
  if (k.includes("applepay")) return "applepay";
  if (k.includes("fawaterak") || k.includes("فواتيرك")) return "fawaterak";
  if (k.includes("fawry") || k.includes("فوري")) return "fawry";
  if (k.includes("banktransfer") || k.includes("تحويلبنكي")) return "bank";
  if (
    k === "cod" ||
    k.includes("cashondelivery") ||
    k.includes("عندالاستلام") ||
    k.includes("الاستلام")
  )
    return "cod";
  // Paymob / Kashier / Moyasar are card acquirers — the shopper recognises the
  // scheme, not the processor, so show the schemes they will actually use.
  if (k.includes("paymob") || k.includes("kashier") || k.includes("moyasar"))
    return "cards";
  return "generic";
}

function Tile({
  children,
  fill = "#ffffff",
  stroke = "rgba(0,0,0,0.14)",
}: {
  children: React.ReactNode;
  fill?: string;
  stroke?: string;
}) {
  return (
    <svg
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      aria-hidden="true"
      className="shrink-0"
      role="presentation"
    >
      <rect
        x="0.5"
        y="0.5"
        width={W - 1}
        height={H - 1}
        rx="3"
        fill={fill}
        stroke={stroke}
      />
      {children}
    </svg>
  );
}

/** Centred wordmark inside the tile. */
function Word({
  text,
  fill,
  size = 8,
  weight = 700,
  italic = false,
  letterSpacing = "0",
}: {
  text: string;
  fill: string;
  size?: number;
  weight?: number;
  italic?: boolean;
  letterSpacing?: string;
}) {
  return (
    <text
      x={W / 2}
      y={H / 2}
      textAnchor="middle"
      dominantBaseline="central"
      fontFamily="system-ui, -apple-system, 'Segoe UI', sans-serif"
      fontSize={size}
      fontWeight={weight}
      fontStyle={italic ? "italic" : "normal"}
      letterSpacing={letterSpacing}
      fill={fill}
    >
      {text}
    </text>
  );
}

export function PaymentMark({
  code,
  label,
  isAr = false,
}: {
  code: string;
  label?: string;
  isAr?: boolean;
}) {
  switch (markKey(code, label)) {
    case "instapay":
      // InstaPay's identity is its violet; the italic cut reads as the mark
      // even at 40px.
      return (
        <Tile>
          <Word text="InstaPay" fill="#63297B" size={7.6} weight={800} italic />
        </Tile>
      );

    case "vodafone":
      return (
        <Tile fill="#E60000" stroke="transparent">
          <Word
            text={isAr ? "فودافون كاش" : "Vodafone"}
            fill="#ffffff"
            size={isAr ? 6.6 : 7.4}
            weight={700}
          />
        </Tile>
      );

    case "fawry":
      return (
        <Tile fill="#FFCC00" stroke="transparent">
          <Word text={isAr ? "فوري" : "fawry"} fill="#0B2C5E" size={8.4} weight={800} />
        </Tile>
      );

    case "fawaterak":
      return (
        <Tile fill="#0C4A6E" stroke="transparent">
          <Word
            text={isAr ? "فواتيرك" : "fawaterak"}
            fill="#ffffff"
            size={6.4}
            weight={700}
          />
        </Tile>
      );

    case "applepay":
      return (
        <Tile fill="#000000" stroke="transparent">
          <g transform={`translate(${W / 2 - 9}, ${H / 2 - 5})`} fill="#ffffff">
            <path
              d="M4.02 2.29c.28-.34.47-.8.42-1.29-.4.02-.9.27-1.19.6-.26.3-.49.78-.43 1.24.45.04.9-.22 1.2-.55zM4.44 2.93c-.66-.04-1.22.37-1.53.37-.32 0-.8-.36-1.31-.35-.68.01-1.3.39-1.65.99-.7 1.22-.18 3.02.5 4.01.34.49.74 1.03 1.26 1.01.5-.02.7-.32 1.3-.32.61 0 .78.32 1.31.31.55-.01.89-.49 1.22-.98.39-.56.55-1.1.56-1.13-.01-.01-1.07-.41-1.08-1.64-.01-1.02.83-1.51.87-1.54-.48-.7-1.22-.78-1.45-.79z"
              transform="scale(1.15)"
            />
            <text
              x="8.5"
              y="5.6"
              fontFamily="system-ui, -apple-system, sans-serif"
              fontSize="7.4"
              fontWeight={600}
              fill="#ffffff"
            >
              Pay
            </text>
          </g>
        </Tile>
      );

    case "cards":
      // Visa + Mastercard side by side: the schemes the shopper actually holds,
      // rather than the acquirer's name which means nothing to them.
      return (
        <Tile>
          <text
            x="10.5"
            y="13"
            textAnchor="middle"
            dominantBaseline="central"
            fontFamily="system-ui, -apple-system, sans-serif"
            fontSize="7.2"
            fontWeight={800}
            fontStyle="italic"
            fill="#1A1F71"
          >
            VISA
          </text>
          <g transform="translate(24.5, 13)">
            <circle cx="-3.1" cy="0" r="4.6" fill="#EB001B" />
            <circle cx="3.1" cy="0" r="4.6" fill="#F79E1B" />
            <path
              d="M0 -3.6a4.6 4.6 0 000 7.2 4.6 4.6 0 000 -7.2z"
              fill="#FF5F00"
            />
          </g>
        </Tile>
      );

    case "cod":
      // No brand to borrow, so this one carries the store's own accent — the
      // method most Egyptian shoppers pick shouldn't look like the fallback.
      //
      // Fill stays the plain surface rather than the accent tint: a tinted
      // tile sitting on a *selected* row (which is also accent-tinted)
      // dissolves into it, so the one method most likely to be chosen lost its
      // mark at exactly the moment it was chosen.
      return (
        <Tile fill="var(--ck-surface)" stroke="var(--ck-accent-line)">
          <g
            transform={`translate(${W / 2 - 8}, ${H / 2 - 5.5})`}
            fill="none"
            stroke="var(--ck-accent)"
            strokeWidth="1.3"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="0.7" y="0.7" width="14.6" height="9.6" rx="1.6" />
            <circle cx="8" cy="5.5" r="2.4" />
            <path d="M3.6 5.5h.02M12.4 5.5h.02" />
          </g>
        </Tile>
      );

    case "bank":
      return (
        <Tile>
          <g
            transform={`translate(${W / 2 - 8}, ${H / 2 - 5.5})`}
            fill="none"
            stroke="var(--ck-fg)"
            strokeWidth="1.3"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M1 4.2 8 1l7 3.2" />
            <path d="M2.6 4.9v4.6M6.2 4.9v4.6M9.8 4.9v4.6M13.4 4.9v4.6" />
            <path d="M1 10.6h14" />
          </g>
        </Tile>
      );

    default:
      return (
        <Tile>
          <g
            transform={`translate(${W / 2 - 8}, ${H / 2 - 5.5})`}
            fill="none"
            stroke="var(--ck-fg)"
            strokeWidth="1.3"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="0.7" y="1.2" width="14.6" height="9.6" rx="1.6" />
            <path d="M0.7 4.6h14.6" />
          </g>
        </Tile>
      );
  }
}
