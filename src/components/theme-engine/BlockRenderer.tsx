import { BlockInstance } from "@/types";
import { BlockLoader } from "./BlockLoader";

interface BlockRendererProps {
  blockId: string;
  block: BlockInstance;
  themeId: string;
}

export function BlockRenderer({ blockId, block, themeId }: BlockRendererProps) {
  if (block.disabled) return null;

  return (
    <div data-block-id={blockId} data-block-type={block.type}>
      <BlockLoader themeId={themeId} blockType={block.type} settings={block.settings} />
    </div>
  );
}
