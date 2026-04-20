import type { BlockProps } from "@/types";
export default function RichText({ settings }: BlockProps) {
  return <div className="prose max-w-none" dangerouslySetInnerHTML={{ __html: settings.html || "" }} />;
}
