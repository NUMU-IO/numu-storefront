import type { BlockProps } from "@/types";
export default function Icon({ settings }: BlockProps) {
  return <span className="text-2xl">{settings.icon || "★"}</span>;
}
