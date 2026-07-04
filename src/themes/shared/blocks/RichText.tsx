import type { BlockProps } from "@/types";
import { sanitizeHtml } from "@/lib/sanitize-html";
export default function RichText({ settings }: BlockProps) {
  // settings.html is merchant-authored → sanitize before it reaches
  // dangerouslySetInnerHTML (stored XSS). See src/lib/sanitize-html.ts.
  return (
    <div
      className="prose max-w-none"
      dangerouslySetInnerHTML={{ __html: sanitizeHtml(settings.html) }}
    />
  );
}
