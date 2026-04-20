import type { BlockProps } from "@/types";
export default function Paragraph({ settings }: BlockProps) {
  return <p className="text-gray-600">{settings.text || ""}</p>;
}
