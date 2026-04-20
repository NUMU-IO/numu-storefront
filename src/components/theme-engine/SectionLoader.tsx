import { resolveSection } from "./ThemeRegistry";
import type { StoreData, BlockInstance } from "@/types";

interface SectionLoaderProps {
  themeId: string;
  sectionType: string;
  settings: Record<string, any>;
  blocks?: Record<string, BlockInstance>;
  blockOrder?: string[];
  storeData?: StoreData;
}

export async function SectionLoader({
  themeId,
  sectionType,
  settings,
  blocks,
  blockOrder,
  storeData,
}: SectionLoaderProps) {
  const Component = await resolveSection(themeId, sectionType);

  if (!Component) {
    return (
      <div className="p-4 text-center text-gray-400 text-sm">
        Section &quot;{sectionType}&quot; not found
      </div>
    );
  }

  return (
    <Component
      settings={settings}
      blocks={blocks}
      blockOrder={blockOrder}
      storeData={storeData}
    />
  );
}
