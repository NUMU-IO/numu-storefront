import type { SectionProps } from "@/types";
export default function RichText({ settings }: SectionProps) {
  return <section className="py-12 px-4 max-w-7xl mx-auto"><h2 className="text-2xl font-bold mb-4">{settings.title || "RichText"}</h2><div className="bg-gray-50 rounded-lg p-8 text-center text-gray-400">RichText section</div></section>;
}
