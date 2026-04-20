import type { BlockProps } from "@/types";
export default function ImageBlock({ settings }: BlockProps) {
  return settings.src ? <img src={settings.src} alt={settings.alt || ""} className="rounded-lg max-w-full" /> : <div className="bg-gray-200 rounded-lg h-48" />;
}
