import type { BlockProps } from "@/types";
export default function Button({ settings }: BlockProps) {
  return <a href={settings.url || "#"} className="inline-block px-6 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition">{settings.label || "Button"}</a>;
}
