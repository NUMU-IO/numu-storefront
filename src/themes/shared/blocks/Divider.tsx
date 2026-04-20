import type { BlockProps } from "@/types";
export default function Divider({ settings }: BlockProps) {
  return <hr className="border-gray-200 my-4" style={{ borderWidth: settings.thickness || 1 }} />;
}
