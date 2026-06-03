"use client";

/**
 * PreviewBridge — iframe-side companion to the dashboard's LivePreview.
 *
 * Mounted only when the URL carries `?preview=true&editor=v3` AND we are
 * inside an iframe. Subscribes to postMessage events from the parent window
 * with origin validation (the editor's origin is passed via `?editor_origin=...`
 * so we don't have to trust window.parent.origin) and:
 *
 *  - On `numu:theme:update`: re-renders by storing the draft in a context
 *    that the existing renderers consume.
 *  - On `numu:theme:highlight`: scrolls + outlines the targeted section.
 *  - On `numu:theme:locale` / `numu:theme:navigate`: imperative side-effects.
 *
 * The bridge announces readiness with `{ type: "numu:editor:ready" }` and
 * relays section clicks back as `{ type: "numu:editor:select", payload }`.
 *
 * It also implements the **Shopify-style preview inspector**: hovering a
 * section draws a dashed outline + type label; the host-selected section gets
 * a solid outline; on click/select it posts `numu:editor:section-rect` so the
 * dashboard's floating SectionPreviewToolbar can dock to the section. Every
 * inspector listener and overlay element lives inside the editor-gated effect
 * (and the iframe guard below), so it is impossible for it to render or fire
 * on the public storefront — see the leak guard in the effect.
 *
 * This works for ANY theme without a bundle rebuild: it targets the
 * `data-section-id` / `data-section-type` / `data-block-id` attributes that the
 * SDK `<Section>`/`<Block>` components (and the built-in SectionRenderer)
 * already render. It does NOT mutate global theme state directly — it
 * dispatches custom events on `window` that the existing ThemeDataProvider
 * subscribes to.
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

const INSPECTOR_COLOR = "#2563eb";

/** Humanize a section type for the hover label: "by-scroll-story" → "Scroll story". */
function humanizeType(raw: string | undefined): string {
  if (!raw) return "Section";
  const t = raw.replace(/^by-/, "").replace(/[-_]/g, " ").trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : "Section";
}

export function PreviewBridge() {
  const params = useSearchParams();
  const isPreview = params.get("preview") === "true";
  const editorParam = params.get("editor");

  useEffect(() => {
    if (!isPreview || editorParam !== "v3") return;
    // Leak guard (defense in depth): the inspector must NEVER run for real
    // shoppers. The query-param gate above already excludes them, but a
    // shopper who manually appends `?preview=true&editor=v3` to a top-level
    // tab still has `window.parent === window`. The editor always loads us in
    // an iframe, so require that too.
    if (typeof window === "undefined" || window.parent === window) return;

    let knownEditorOrigin = "";

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
          // The DOM re-renders from the new draft; re-anchor the selection
          // outline once React has committed.
          scheduleReposition();
          break;
        case "numu:theme:highlight":
          window.dispatchEvent(
            new CustomEvent("numu:theme-highlight", { detail: data.payload }),
          );
          applyHighlight(data.payload as { sectionId?: string } | undefined);
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

    // ── Inspector overlay (editor-only) ──────────────────────────────────
    // Imperative, JS-managed overlay elements (created here, removed in the
    // effect cleanup) — no global CSS, so zero risk of a visual artifact on
    // the public site even if a future refactor mis-gates.
    function makeBox(dashed: boolean): HTMLDivElement {
      const b = document.createElement("div");
      b.style.cssText = [
        "position:fixed",
        "pointer-events:none",
        "box-sizing:border-box",
        "display:none",
        "border-radius:2px",
        "transition:top .04s linear,left .04s linear,width .04s linear,height .04s linear",
        `border:2px ${dashed ? "dashed" : "solid"} ${INSPECTOR_COLOR}`,
        dashed ? "background:rgba(37,99,235,0.06)" : "background:transparent",
        `z-index:${dashed ? 2147483645 : 2147483644}`,
      ].join(";");
      document.body.appendChild(b);
      return b;
    }
    const hoverBox = makeBox(true);
    const selectBox = makeBox(false);
    const label = document.createElement("div");
    label.style.cssText = [
      "position:fixed",
      "pointer-events:none",
      "display:none",
      "z-index:2147483646",
      `background:${INSPECTOR_COLOR}`,
      "color:#fff",
      "font:600 11px/1.5 system-ui,-apple-system,sans-serif",
      "padding:1px 7px",
      "border-radius:4px 4px 0 0",
      "white-space:nowrap",
      "letter-spacing:.02em",
    ].join(";");
    document.body.appendChild(label);

    let hoveredEl: HTMLElement | null = null;
    let selectedId: string | null = null;
    let rafPending = false;

    function place(box: HTMLDivElement, el: Element) {
      const r = el.getBoundingClientRect();
      box.style.top = `${r.top}px`;
      box.style.left = `${r.left}px`;
      box.style.width = `${r.width}px`;
      box.style.height = `${r.height}px`;
      box.style.display = "block";
    }

    function findSection(id: string | null): HTMLElement | null {
      if (!id) return null;
      try {
        return document.querySelector(
          `[data-section-id="${CSS.escape(id)}"]`,
        ) as HTMLElement | null;
      } catch {
        return null;
      }
    }

    function hideHover() {
      hoveredEl = null;
      hoverBox.style.display = "none";
      label.style.display = "none";
    }

    function onPointerMove(e: MouseEvent) {
      const target = e.target as Element | null;
      const el = target?.closest("[data-section-id]") as HTMLElement | null;
      if (!el) {
        if (hoveredEl) hideHover();
        return;
      }
      if (el === hoveredEl) return;
      hoveredEl = el;
      place(hoverBox, el);
      const r = el.getBoundingClientRect();
      label.textContent = humanizeType(el.dataset.sectionType);
      label.style.top = `${Math.max(0, r.top - 20)}px`;
      label.style.left = `${r.left}px`;
      label.style.display = "block";
    }

    function repositionSelected() {
      const el = findSection(selectedId);
      if (!el) {
        selectBox.style.display = "none";
        return;
      }
      place(selectBox, el);
      const r = el.getBoundingClientRect();
      // Keep the dashboard's floating SectionPreviewToolbar docked to the
      // selected section.
      send("numu:editor:section-rect", {
        sectionId: selectedId,
        rect: { top: r.top, left: r.left, width: r.width, height: r.height },
      });
    }

    function applyHighlight(payload: { sectionId?: string } | undefined) {
      selectedId = payload?.sectionId ?? null;
      const el = findSection(selectedId);
      if (el) {
        place(selectBox, el);
        el.scrollIntoView({ behavior: "smooth", block: "nearest" });
        scheduleReposition();
      } else {
        selectBox.style.display = "none";
      }
    }

    function scheduleReposition() {
      if (rafPending) return;
      rafPending = true;
      requestAnimationFrame(() => {
        rafPending = false;
        repositionSelected();
      });
    }

    function onScrollOrResize() {
      // Hover is stale after the layout shifts; selection re-anchors.
      hideHover();
      scheduleReposition();
    }

    // Click delegation: any element with `data-section-id` reports its
    // selection back to the editor. The host echoes a `numu:theme:highlight`
    // which drives the solid outline (see applyHighlight).
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

    window.addEventListener("message", handleMessage);
    document.addEventListener("click", handleClick, true);
    document.addEventListener("mousemove", onPointerMove, true);
    document.addEventListener("mouseleave", hideHover);
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);

    // Announce readiness once the listener is wired.
    send("numu:editor:ready");

    return () => {
      window.removeEventListener("message", handleMessage);
      document.removeEventListener("click", handleClick, true);
      document.removeEventListener("mousemove", onPointerMove, true);
      document.removeEventListener("mouseleave", hideHover);
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
      hoverBox.remove();
      selectBox.remove();
      label.remove();
    };
  }, [isPreview, editorParam]);

  return null;
}
