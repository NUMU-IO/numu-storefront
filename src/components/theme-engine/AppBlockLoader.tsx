"use client";

interface AppBlockLoaderProps {
  blockType: string;
  settings: Record<string, any>;
}

export default function AppBlockLoader({ blockType, settings }: AppBlockLoaderProps) {
  // Parse @app/{slug}/{type}
  const parts = blockType.replace("@app/", "").split("/");
  const appSlug = parts[0] || "unknown";
  const blockName = parts[1] || "default";

  return (
    <div
      data-app-block={blockType}
      className="border border-dashed border-gray-300 rounded p-4 text-center text-sm text-gray-500"
    >
      <p>App Block: {appSlug}/{blockName}</p>
      <p className="text-xs mt-1">Third-party extension placeholder</p>
    </div>
  );
}
