import { Fragment } from "react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import {
  Cancel01Icon,
  CleanIcon,
  ClipboardPasteIcon,
  ColorPickerIcon,
  Copy01Icon,
  Mic01Icon,
  TextSelectIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { SearchAddon } from "@xterm/addon-search";
import { TerminalPane, type TerminalPaneHandle } from "./TerminalPane";
import { useTerminalDropStore } from "./lib/dropStore";
import {
  TERMINAL_PANE_COLORS,
  terminalPaneBackgroundValue,
  terminalPaneColorIdFromValue,
  terminalPaneColorValue,
  type TerminalPaneColorId,
} from "./lib/paneColors";
import type { PaneNode } from "./lib/panes";
import {
  clearLeafScreen,
  copyLeafSelection,
  pasteClipboardIntoLeaf,
  selectAllLeaf,
} from "./lib/rendererPool";

type LeafBundle = {
  setRef: (h: TerminalPaneHandle | null) => void;
  onSearch: (addon: SearchAddon) => void;
  onCwd: (cwd: string) => void;
  onExit: (code: number) => void;
};

type Props = {
  node: PaneNode;
  tabVisible: boolean;
  activeLeafId: number;
  blocks: boolean;
  onFocusLeaf: (leafId: number) => void;
  onSetLeafColor: (
    leafId: number,
    color: TerminalPaneColorId | undefined,
  ) => void;
  onCloseLeaf: (leafId: number) => void;
  onToggleAiVoice: () => void;
  canCloseLeaf: boolean;
  getBundle: (leafId: number) => LeafBundle;
};

export function PaneTreeView({
  node,
  tabVisible,
  activeLeafId,
  blocks,
  onFocusLeaf,
  onSetLeafColor,
  onCloseLeaf,
  onToggleAiVoice,
  canCloseLeaf,
  getBundle,
}: Props) {
  if (node.kind === "leaf") {
    const focused = node.id === activeLeafId;
    const b = getBundle(node.id);
    const paneBackground = terminalPaneBackgroundValue(node.color);
    const paneStyle = paneBackground
      ? { backgroundColor: paneBackground }
      : undefined;

    return (
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            onMouseDownCapture={() => {
              if (!focused) onFocusLeaf(node.id);
            }}
            // Catches focus from Tab, programmatic focus, or any path that
            // skips mousedown — keeps activeLeafId in sync with DOM focus.
            onFocus={() => {
              if (!focused) onFocusLeaf(node.id);
            }}
            data-pane-leaf={node.id}
            className="relative h-full w-full overflow-hidden bg-background transition-colors"
            style={paneStyle}
          >
            <TerminalPane
              leafId={node.id}
              visible={tabVisible}
              focused={focused}
              initialCwd={node.cwd}
              blocks={blocks}
              paneBackground={paneBackground}
              ref={b.setRef}
              onSearchReady={(_id, addon) => b.onSearch(addon)}
              onCwd={(_id, cwd) => b.onCwd(cwd)}
              onExit={(_id, code) => b.onExit(code)}
            />
            <DropOverlay leafId={node.id} />
          </div>
        </ContextMenuTrigger>
        <TerminalPaneContextMenu
          color={node.color}
          onCopy={() => copyLeafSelection(node.id)}
          onPaste={() => pasteClipboardIntoLeaf(node.id)}
          onSelectAll={() => selectAllLeaf(node.id)}
          onClear={() => clearLeafScreen(node.id)}
          onToggleAiVoice={onToggleAiVoice}
          onColorChange={(color) => onSetLeafColor(node.id, color)}
          onClose={() => onCloseLeaf(node.id)}
          canClose={canCloseLeaf}
        />
      </ContextMenu>
    );
  }

  return (
    <ResizablePanelGroup
      orientation={node.dir === "row" ? "horizontal" : "vertical"}
    >
      {node.children.map((child, i) => (
        <Fragment key={child.id}>
          {i > 0 && <ResizableHandle />}
          <ResizablePanel id={`pane-${child.id}`} minSize="10%">
            <PaneTreeView
              node={child}
              tabVisible={tabVisible}
              activeLeafId={activeLeafId}
              blocks={blocks}
              onFocusLeaf={onFocusLeaf}
              onSetLeafColor={onSetLeafColor}
              onCloseLeaf={onCloseLeaf}
              onToggleAiVoice={onToggleAiVoice}
              canCloseLeaf={canCloseLeaf}
              getBundle={getBundle}
            />
          </ResizablePanel>
        </Fragment>
      ))}
    </ResizablePanelGroup>
  );
}

function TerminalPaneContextMenu({
  color,
  onCopy,
  onPaste,
  onSelectAll,
  onClear,
  onToggleAiVoice,
  onColorChange,
  onClose,
  canClose,
}: {
  color: TerminalPaneColorId | undefined;
  onCopy: () => void;
  onPaste: () => void;
  onSelectAll: () => void;
  onClear: () => void;
  onToggleAiVoice: () => void;
  onColorChange: (color: TerminalPaneColorId | undefined) => void;
  onClose: () => void;
  canClose: boolean;
}) {
  return (
    <ContextMenuContent
      className="min-w-52"
      onCloseAutoFocus={(event) => event.preventDefault()}
    >
      <ContextMenuItem onSelect={onCopy}>
        <HugeiconsIcon icon={Copy01Icon} size={14} strokeWidth={1.75} />
        <span className="flex-1">Copy</span>
      </ContextMenuItem>
      <ContextMenuItem onSelect={onPaste}>
        <HugeiconsIcon icon={ClipboardPasteIcon} size={14} strokeWidth={1.75} />
        <span className="flex-1">Paste</span>
      </ContextMenuItem>
      <ContextMenuItem onSelect={onSelectAll}>
        <HugeiconsIcon icon={TextSelectIcon} size={14} strokeWidth={1.75} />
        <span className="flex-1">Select All</span>
      </ContextMenuItem>
      <ContextMenuItem onSelect={onClear}>
        <HugeiconsIcon icon={CleanIcon} size={14} strokeWidth={1.75} />
        <span className="flex-1">Clear Terminal</span>
      </ContextMenuItem>
      <ContextMenuItem onSelect={onToggleAiVoice}>
        <HugeiconsIcon icon={Mic01Icon} size={14} strokeWidth={1.75} />
        <span className="flex-1">Toggle Speech Input</span>
        <span className="text-[11px] text-muted-foreground">Ctrl+S</span>
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuSub>
        <ContextMenuSubTrigger>
          <HugeiconsIcon icon={ColorPickerIcon} size={14} strokeWidth={1.75} />
          <span className="flex-1">Set Terminal Color</span>
          {color ? <ColorSwatch color={terminalPaneColorValue(color)} /> : null}
        </ContextMenuSubTrigger>
        <ContextMenuSubContent className="min-w-40">
          <ContextMenuRadioGroup
            value={color ?? "none"}
            onValueChange={(value) => {
              onColorChange(
                value === "none"
                  ? undefined
                  : terminalPaneColorIdFromValue(value),
              );
            }}
          >
            <ContextMenuRadioItem value="none">
              <span className="size-3 rounded-full border border-border/70" />
              None
            </ContextMenuRadioItem>
            {TERMINAL_PANE_COLORS.map((paneColor) => (
              <ContextMenuRadioItem key={paneColor.id} value={paneColor.id}>
                <ColorSwatch color={paneColor.value} />
                {paneColor.label}
              </ContextMenuRadioItem>
            ))}
          </ContextMenuRadioGroup>
        </ContextMenuSubContent>
      </ContextMenuSub>
      <ContextMenuSeparator />
      <ContextMenuItem
        variant="destructive"
        disabled={!canClose}
        onSelect={onClose}
      >
        <HugeiconsIcon icon={Cancel01Icon} size={14} strokeWidth={1.75} />
        <span className="flex-1">Close This Terminal</span>
      </ContextMenuItem>
    </ContextMenuContent>
  );
}

function ColorSwatch({ color }: { color: string | undefined }) {
  return (
    <span
      aria-hidden="true"
      className="size-3 rounded-full border border-foreground/10 shadow-[0_0_0_1px_rgba(0,0,0,0.2)]"
      style={{ backgroundColor: color ?? "transparent" }}
    />
  );
}

function DropOverlay({ leafId }: { leafId: number }) {
  const active = useTerminalDropStore((s) => s.targetLeafId === leafId);
  if (!active) return null;
  return (
    <div className="pointer-events-none absolute inset-2 grid place-items-center rounded-lg border border-primary/45 bg-background/70 text-xs font-medium text-foreground shadow-lg backdrop-blur-sm">
      Drop file path here
    </div>
  );
}
