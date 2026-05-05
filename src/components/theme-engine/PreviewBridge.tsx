"use client";

/**
 * PreviewBridge — iframe-side companion to the dashboard's LivePreview.
 *
 * Mounted only when the URL carries `?preview=true&editor=v3`. Subscribes
 * to postMessage events from the parent window with origin validation
 * (the editor's origin is passed via `?editor_origin=...` so we don't have
 * to trust window.parent.origin) and:
 *
 *  - On `numu:theme:update`: re-renders by storing the draft in a context
 *    that the existing renderers consume.
 *  - On `numu:theme:highlight`: scrolls + outlines the targeted section.
 *  - On `numu:theme:locale` / `numu:theme:navigate`: imperative side-effects.
 *
 * The bridge announces readiness with `{ type: "numu:editor:ready" }` and
 * relays section clicks back as `{ type: "numu:editor:select", payload }`.
 *
 * This file deliberately does NOT mutate global theme state directly — it
 * dispatches custom events on `window` that the existing ThemeDataProvider
 * subscribes to. Themes that want richer integration can listen for the
 * same events.
 */

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";

const ALLOWED_EDITOR_ORIGINS = [
  "https://app.numueg.app",
  "https://merchant.numueg.app",
  "https://numueg.app",
  // Dev:
  "http://localhost:5173",
  "http://localhost:8080",
];

function isAllowedEditorOrigin(origin: string): boolean {
  if (ALLOWED_EDITOR_ORIGINS.includes(origin)) return true;
  // Allow any *.numueg.app subdomain for staging previews.
  try {
    const url = new URL(origin);
    return url.hostname.endsWith(".numueg.app");
  } catch {
    return false;
  }
}

export function PreviewBridge() {
  const params = useSearchParams();
  const isPreview = params.get("preview") === "true";
  const editorParam = params.get("editor");

  useEffect(() => {
    if (!isPreview || editorParam !== "v3") return;

    function send(type: string, payload?: unknown) {
      // postMessage to a wildcard target only when the parent's origin
      // hasn't been validated yet. After the first inbound message we
      // know the trusted origin and use it.
      if (knownEditorOrigin) {
        window.parent?.postMessage({ type, payload }, knownEditorOrigin);
      } else {
        window.parent?.postMessage({ type, payload }, "*");
      }
    }

    let knownEditorOrigin = "";

    function handleMessage(event: MessageEvent) {
      // Trust gate: only accept messages from origins we recognize as
      // dashboard hosts. The first valid message latches the origin so
      // we can use it for outbound replies too.
      if (!isAllowedEditorOrigin(event.origin)) return;
      knownEditorOrigin = event.origin;

      const data = event.data as { type?: string; payload?: unknown } | null;
      if (!data?.type || typeof data.type !== "string") return;

      switch (data.type) {
        case "numu:theme:update":
          window.dispatchEvent(
            new CustomEvent("numu:theme-update", { detail: data.payload }),
          );
          break;
        case "numu:theme:highlight":
          window.dispatchEvent(
            new CustomEvent("numu:theme-highlight", { detail: data.payload }),
          );
          break;
        case "numu:theme:locale":
          window.dispatchEvent(
            new CustomEvent("numu:theme-locale", { detail: data.payload }),
          );
          break;
        case "numu:theme:navigate": {
          const payload = data.payload as { page?: string } | undefined;
          if (payload?.page) {
            window.dispatchEvent(
              new CustomEvent("numu:theme-navigate", {
                detail: { page: payload.page },
              }),
            );
          }
          break;
        }
      }
    }

    window.addEventListener("message", handleMessage);

    // Click delegation: any element with `data-section-id` reports its
    // selection back to the editor. Themes annotate sections in their
    // SectionRenderer wrapper (see SectionRenderer.tsx).
    function handleClick(e: MouseEvent) {
      const target = e.target as Element | null;
      if (!target) return;
      const sectionEl = target.closest("[data-section-id]") as
        | HTMLElement
        | null;
      if (!sectionEl) return;
      const blockEl = target.closest("[data-block-id]") as HTMLElement | null;
      e.preventDefault();
      send("numu:editor:select", {
        sectionId: sectionEl.dataset.sectionId,
        blockId: blockEl?.dataset.blockId ?? null,
        groupId: sectionEl.dataset.groupId ?? null,
      });
    }
    document.addEventListener("click", handleClick, true);

    // Announce readiness once the listener is wired.
    send("numu:editor:ready");

    return () => {
      window.removeEventListener("message", handleMessage);
      document.removeEventListener("click", handleClick, true);
    };
  }, [isPreview, editorParam]);

  return null;
}
