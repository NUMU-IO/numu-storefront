import type { BlockProps } from "@/types";
import type { ElementType } from "react";

export default function Heading({ settings }: BlockProps) {
  const Tag: ElementType = settings.level || "h2";
  return <Tag className="font-bold">{settings.text || "Heading"}</Tag>;
}
