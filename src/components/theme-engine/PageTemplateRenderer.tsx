import { PageTemplate, StoreData } from "@/types";
import { SectionRenderer } from "./SectionRenderer";

interface PageTemplateRendererProps {
  template: PageTemplate;
  themeId: string;
  storeData?: StoreData;
}

export function PageTemplateRenderer({ template, themeId, storeData }: PageTemplateRendererProps) {
  return (
    <main>
      {template.order.map((sectionId) => {
        const section = template.sections[sectionId];
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
    </main>
  );
}
