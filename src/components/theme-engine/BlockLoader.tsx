import { resolveBlock } from "./ThemeRegistry";
import dynamic from "next/dynamic";

const AppBlockLoader = dynamic(() => import("./AppBlockLoader"), { ssr: false });

interface BlockLoaderProps {
  themeId: string;
  blockType: string;
  settings: Record<string, any>;
}

export async function BlockLoader({ themeId, blockType, settings }: BlockLoaderProps) {
  // Route @app/ blocks to the client-side AppBlockLoader
  if (blockType.startsWith("@app/")) {
    return <AppBlockLoader blockType={blockType} settings={settings} />;
  }

  const Component = await resolveBlock(themeId, blockType);

  if (!Component) {
    return (
      <div className="p-2 text-center text-gray-400 text-xs">
        Block &quot;{blockType}&quot; not found
      </div>
    );
  }

  return <Component settings={settings} />;
}
