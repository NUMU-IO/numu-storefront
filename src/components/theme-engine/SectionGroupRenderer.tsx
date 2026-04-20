import { SectionGroup, StoreData } from "@/types";
import { SectionRenderer } from "./SectionRenderer";

interface SectionGroupRendererProps {
  group: SectionGroup;
  themeId: string;
  storeData?: StoreData;
}

export function SectionGroupRenderer({ group, themeId, storeData }: SectionGroupRendererProps) {
  return (
    <>
      {group.order.map((sectionId) => {
        const section = group.sections[sectionId];
        if (!section) return null;
        return (
          <SectionRenderer
            key={sectionId}
            sectionId={sectionId}
            section={section}
            themeId={themeId}
            storeData={storeData}
          />
        );
      })}
    </>
  );
}
