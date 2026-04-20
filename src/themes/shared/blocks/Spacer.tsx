import type { BlockProps } from "@/types";
export default function Spacer({ settings }: BlockProps) {
  return <div style={{ height: settings.height || 40 }} />;
}
