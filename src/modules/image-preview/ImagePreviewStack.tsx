import { cn } from "@/lib/utils";
import type { ImagePreviewTab, Tab } from "@/modules/tabs";
import { ImagePreviewPane } from "./ImagePreviewPane";

type Props = {
  tabs: Tab[];
  activeId: number;
};

export function ImagePreviewStack({ tabs, activeId }: Props) {
  const images = tabs.filter(
    (t): t is ImagePreviewTab => t.kind === "image-preview",
  );
  if (images.length === 0) return null;
  return (
    <div className="relative h-full w-full">
      {images.map((t) => {
        const visible = t.id === activeId;
        return (
          <div
            key={t.id}
            className={cn(
              "absolute inset-0",
              !visible && "invisible pointer-events-none",
            )}
            aria-hidden={!visible}
          >
            <ImagePreviewPane path={t.path} visible={visible} />
          </div>
        );
      })}
    </div>
  );
}
