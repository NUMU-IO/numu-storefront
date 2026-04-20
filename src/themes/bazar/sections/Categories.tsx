import type { SectionProps } from "@/types";
export default function Categories({ settings }: SectionProps) {
  return <section className="py-16 px-4 max-w-7xl mx-auto"><h2 className="text-3xl font-bold text-center mb-8">{settings.title || "Categories"}</h2><div className="grid grid-cols-2 md:grid-cols-4 gap-4"><div className="bg-gray-100 rounded-lg h-40 flex items-center justify-center">Category</div></div></section>;
}
