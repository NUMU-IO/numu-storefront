import type { SectionProps } from "@/types";

export default function FeaturedProducts({ settings }: SectionProps) {
  return (
    <section className="py-16 px-4 max-w-7xl mx-auto">
      <h2 className="text-3xl font-bold text-center mb-12">{settings.title || "Featured Products"}</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="bg-gray-100 rounded-lg p-4 h-64 flex items-center justify-center text-gray-400">Product placeholder</div>
        <div className="bg-gray-100 rounded-lg p-4 h-64 flex items-center justify-center text-gray-400">Product placeholder</div>
        <div className="bg-gray-100 rounded-lg p-4 h-64 flex items-center justify-center text-gray-400">Product placeholder</div>
        <div className="bg-gray-100 rounded-lg p-4 h-64 flex items-center justify-center text-gray-400">Product placeholder</div>
      </div>
    </section>
  );
}
