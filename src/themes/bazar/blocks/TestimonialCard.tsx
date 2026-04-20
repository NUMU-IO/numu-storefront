import type { BlockProps } from "@/types";
export default function TestimonialCard({ settings }: BlockProps) {
  return <div className="bg-white rounded-lg shadow p-6"><p className="italic text-gray-600">&quot;{settings.quote || "Great product!"}&quot;</p><p className="mt-4 font-semibold">{settings.author || "Customer"}</p></div>;
}
