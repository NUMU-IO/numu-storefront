import type { SectionProps } from "@/types";
export default function AnnouncementBar({ settings }: SectionProps) {
  if (!settings.message) return null;
  return <div className="bg-blue-600 text-white text-center py-2 text-sm">{settings.message}</div>;
}
