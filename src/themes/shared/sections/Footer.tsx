import type { SectionProps } from "@/types";
export default function Footer({ settings, storeData }: SectionProps) {
  return <footer className="bg-gray-900 text-gray-400 py-12"><div className="max-w-7xl mx-auto px-4 text-center"><p>&copy; {new Date().getFullYear()} {storeData?.name || "Store"}. All rights reserved.</p><p className="mt-2 text-sm">Powered by NUMU</p></div></footer>;
}
