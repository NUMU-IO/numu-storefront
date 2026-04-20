import type { BlockProps } from "@/types";
export default function CategoryCard({ settings }: BlockProps) {
  return <div className="bg-gray-100 rounded-lg p-6 text-center"><h3 className="font-semibold">{settings.title || "Category"}</h3></div>;
}
