import type { SectionProps } from "@/types";
export default function ImageWithText({ settings }: SectionProps) {
  return <section className="py-12 px-4 max-w-7xl mx-auto"><h2 className="text-2xl font-bold mb-4">{settings.title || "ImageWithText"}</h2><div className="bg-gray-50 rounded-lg p-8 text-center text-gray-400">ImageWithText section</div></section>;
}
