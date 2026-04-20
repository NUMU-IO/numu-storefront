import { SectionInstance, StoreData } from "@/types";
import { SectionLoader } from "./SectionLoader";

interface SectionRendererProps {
  sectionId: string;
  section: SectionInstance;
  themeId: string;
  storeData?: StoreData;
}

export function SectionRenderer({ sectionId, section, themeId, storeData }: SectionRendererProps) {
  if (section.disabled) return null;

  return (
    <div data-section-id={sectionId} data-section-type={section.type}>
      <SectionLoader
        themeId={themeId}
        sectionType={section.type}
        settings={section.settings}
        blocks={section.blocks}
        blockOrder={section.block_order}
        storeData={storeData}
      />
    </div>
  );
}
