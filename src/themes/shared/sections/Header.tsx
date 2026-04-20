import type { SectionProps } from "@/types";
export default function Header({ settings, storeData }: SectionProps) {
  return <header className="bg-white shadow-sm border-b"><div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between"><div className="font-bold text-xl">{storeData?.name || settings.store_name || "Store"}</div><nav className="hidden md:flex gap-6 text-gray-600"><a href="/" className="hover:text-gray-900">Home</a><a href="/collections" className="hover:text-gray-900">Shop</a></nav></div></header>;
}
