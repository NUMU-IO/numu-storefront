"use client";

import { useEffect, useRef, useState } from "react";

interface PaymobPixelProps {
  publicKey: string;
  clientSecret: string;
  onComplete: (success: boolean) => void;
  onCancel: () => void;
  locale?: string;
  accentColor?: string;
}

/**
 * Paymob Pixel embedded checkout — ported from the bazaar storefront so the
 * v3 storefront can collect card payments inline. The backend returns
 * paymob_client_secret + paymob_public_key from POST /checkout for Paymob
 * stores; without this the order is created but never paid.
 *
 * Dynamically loads the Pixel SDK from the CDN and renders the form into
 * #paymob-elements. NOTE: requires the storefront CSP to allow
 * cdn.jsdelivr.net (script-src/style-src) and Paymob frames.
 */
export function PaymobPixel({
  publicKey,
  clientSecret,
  onComplete,
  onCancel,
  locale = "en",
  accentColor,
}: PaymobPixelProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const initializedRef = useRef(false);
  const isAr = locale === "ar";

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    const elements: HTMLElement[] = [];

    const link1 = document.createElement("link");
    link1.rel = "stylesheet";
    link1.href = "https://cdn.jsdelivr.net/npm/paymob-pixel@latest/styles.css";
    document.head.appendChild(link1);
    elements.push(link1);

    const link2 = document.createElement("link");
    link2.rel = "stylesheet";
    link2.href = "https://cdn.jsdelivr.net/npm/paymob-pixel@latest/main.css";
    document.head.appendChild(link2);
    elements.push(link2);

    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/paymob-pixel@latest/main.js";
    script.type = "module";

    script.onload = () => {
      setLoading(false);
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const PixelClass = (window as any).Pixel;
        if (!PixelClass) {
          setError(isAr ? "تعذّر تحميل نموذج الدفع" : "Pixel SDK failed to load");
          return;
        }
        new PixelClass({
          publicKey,
          clientSecret,
          paymentMethods: ["card"],
          elementId: "paymob-elements",
          afterPaymentComplete: (response: { success?: boolean }) => {
            onComplete(response?.success ?? false);
          },
          onPaymentCancel: () => {
            onCancel();
          },
          ...(accentColor
            ? {
                customStyle: {
                  Color_Primary: accentColor,
                  Width_of_Container: "100%",
                  Radius_Border: "8",
                },
              }
            : {}),
        });
      } catch (err) {
        setError(
          isAr ? "تعذّر تهيئة نموذج الدفع" : "Failed to initialize payment form",
        );
        console.error("Pixel init error:", err);
      }
    };

    script.onerror = () => {
      setLoading(false);
      setError(isAr ? "تعذّر تحميل أداة الدفع" : "Failed to load payment SDK");
    };

    document.head.appendChild(script);
    elements.push(script);

    return () => {
      elements.forEach((el) => {
        try {
          el.parentNode?.removeChild(el);
        } catch {
          /* already removed */
        }
      });
    };
  }, [publicKey, clientSecret, onComplete, onCancel, accentColor, isAr]);

  if (error) {
    return (
      <div className="py-8 text-center">
        <p className="text-sm text-red-700">{error}</p>
        <button
          type="button"
          onClick={onCancel}
          className="mt-3 text-sm text-gray-600 underline"
        >
          {isAr ? "العودة" : "Go back"}
        </button>
      </div>
    );
  }

  return (
    <div>
      {loading && (
        <div className="py-8 text-center">
          <div className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-current border-t-transparent" />
          <p className="mt-2 text-sm text-gray-500">
            {isAr ? "جارٍ تحميل نموذج الدفع…" : "Loading payment form…"}
          </p>
        </div>
      )}
      <div id="paymob-elements" />
    </div>
  );
}
