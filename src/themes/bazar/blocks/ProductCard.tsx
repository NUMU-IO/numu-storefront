import type { BlockProps } from "@/types";
export default function ProductCard({ settings }: BlockProps) {
  return <div className="bg-white rounded-lg shadow p-4"><div className="bg-gray-100 h-48 rounded mb-3" /><h3 className="font-semibold">{settings.title || "Product"}</h3><p className="text-gray-600">{settings.price || "$0.00"}</p></div>;
}
