import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  FileAddIcon,
  Folder01Icon,
  FolderAddIcon,
  Refresh01Icon,
  Search01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { invoke } from "@tauri-apps/api/core";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  ClipboardEvent as ReactClipboardEvent,
  DragEvent as ReactDragEvent,
} from "react";
import { DeleteConfirmDialog, type DeleteTarget } from "./DeleteConfirmDialog";
import { ExplorerSearch, type ExplorerSearchHandle } from "./ExplorerSearch";
import { EntryRow, PendingRow, StatusRow } from "./TreeRow";
import { InlineInput } from "./InlineInput";
import {
  NATIVE_PATH_DROP_EVENT,
  NATIVE_PATH_DROP_TARGET_EVENT,
  type NativePathDropEventDetail,
  type NativePathDropTarget,
} from "@/modules/file-transfer/useNativePathDropRouter";
import { getFileClipboard } from "@/modules/file-transfer/fileClipboardStore";
import {
  filesFromDataTransfer,
  generatedPastedImageName,
  isImageBlob,
  parsePathText,
  usableFileName,
} from "@/modules/file-transfer/pathPayload";
import {
  copyFilePaths,
  copyToClipboard,
  revealInFinder,
} from "./lib/contextActions";
import { fileIconUrl, folderIconUrl } from "./lib/iconResolver";
import { COMPACT_CONTENT, COMPACT_ITEM } from "./lib/menuItemClass";
import { dirname, useFileTree } from "./lib/useFileTree";
import { useGlobalShortcuts } from "@/modules/shortcuts";

export type FileExplorerHandle = {
  focus: () => void;
  isFocused: () => boolean;
  focusSearch: () => void;
};

type Props = {
  rootPath: string | null;
  activeFilePath?: string | null;
  onOpenFile: (path: string, pin?: boolean) => void;
  onPathRenamed?: (from: string, to: string) => void;
  onPathDeleted?: (path: string) => void;
  onRevealInTerminal?: (path: string) => void;
  onAttachToAgent?: (path: string) => void;
  onOpenMarkdownPreview?: (path: string) => void;
};

type Row =
  | {
      kind: "entry";
      key: string;
      path: string;
      name: string;
      isDir: boolean;
      isExpanded: boolean;
      depth: number;
    }
  | {
      kind: "rename";
      key: string;
      path: string;
      name: string;
      isDir: boolean;
      depth: number;
    }
  | { kind: "pending"; key: string; depth: number; pendingKind: "file" | "dir" }
  | {
      kind: "status";
      key: string;
      depth: number;
      tone: "muted" | "error";
      message: string;
    };

const ROW_HEIGHT = 24;
const OVERSCAN = 8;

function basename(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : path;
}

function pastedFileName(file: File, now: Date): string {
  const usable = usableFileName(file.name);
  if (usable) return usable;
  if (isImageBlob(file, file.name)) {
    return generatedPastedImageName(now, file.type || "image/png");
  }
  return `pasted-file-${compactTimestamp(now)}.bin`;
}

function compactTimestamp(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

async function blobBytes(blob: Blob): Promise<number[]> {
  return Array.from(new Uint8Array(await blob.arrayBuffer()));
}

function samePaths(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((path, index) => path === right[index]);
}

function clipboardTextMatchesPaths(
  text: string,
  paths: readonly string[],
): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (trimmed === paths.join("\n")) return true;
  return samePaths(parsePathText(trimmed), paths);
}

async function readNativeClipboardFilePaths(): Promise<string[]> {
  return await invoke<string[]>("clipboard_read_file_paths");
}

function buildRows(
  rootPath: string,
  tree: ReturnType<typeof useFileTree>,
): { rows: Row[]; entryIndexByPath: Map<string, number> } {
  const rows: Row[] = [];
  const entryIndexByPath = new Map<string, number>();

  const walk = (parent: string, depth: number) => {
    const node = tree.nodes[parent];
    if (node?.status !== "loaded") return;
    for (const entry of node.entries) {
      const path = tree.joinPath(parent, entry.name);
      const isDir = entry.kind === "dir";
      const expanded = isDir && tree.expanded.has(path);
      const isRenaming = tree.renaming === path;
      if (isRenaming) {
        rows.push({
          kind: "rename",
          key: `rename:${path}`,
          path,
          name: entry.name,
          isDir,
          depth,
        });
      } else {
        entryIndexByPath.set(path, rows.length);
        rows.push({
          kind: "entry",
          key: path,
          path,
          name: entry.name,
          isDir,
          isExpanded: expanded,
          depth,
        });
      }
      if (isDir && expanded) {
        const child = tree.nodes[path];
        if (tree.pendingCreate?.parentPath === path) {
          rows.push({
            kind: "pending",
            key: `pending:${path}`,
            depth: depth + 1,
            pendingKind: tree.pendingCreate.kind,
          });
        }
        if (child?.status === "loading") {
          rows.push({
            kind: "status",
            key: `loading:${path}`,
            depth: depth + 1,
            tone: "muted",
            message: "Loading…",
          });
        } else if (child?.status === "error") {
          rows.push({
            kind: "status",
            key: `error:${path}`,
            depth: depth + 1,
            tone: "error",
            message: child.message,
          });
        } else if (child?.status === "loaded") {
          walk(path, depth + 1);
        }
      }
    }
  };

  walk(rootPath, 0);
  return { rows, entryIndexByPath };
}

export const FileExplorer = forwardRef<FileExplorerHandle, Props>(
  function FileExplorer(
    {
      rootPath,
      activeFilePath,
      onOpenFile,
      onPathRenamed,
      onPathDeleted,
      onRevealInTerminal,
      onAttachToAgent,
      onOpenMarkdownPreview,
    },
    ref,
  ) {
    const tree = useFileTree(rootPath, { onPathRenamed, onPathDeleted });
    const [selectedPath, setSelectedPath] = useState<string | null>(null);
    const [isSearchOpen, setIsSearchOpen] = useState(false);
    const [isSearchActive, setIsSearchActive] = useState(false);
    const searchRef = useRef<ExplorerSearchHandle>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const scrollRef = useRef<HTMLDivElement>(null);
    const [hoveredPath, setHoveredPath] = useState<string | null>(null);
    const [dropTargetDir, setDropTargetDir] = useState<string | null>(null);
    const [operationError, setOperationError] = useState<string | null>(null);
    const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
    const errorTimerRef = useRef<number | null>(null);
    const pasteEventCounterRef = useRef(0);

    const { rows, entryIndexByPath } = useMemo(() => {
      if (!rootPath)
        return {
          rows: [] as Row[],
          entryIndexByPath: new Map<string, number>(),
        };
      return buildRows(rootPath, tree);
    }, [
      rootPath,
      tree.nodes,
      tree.expanded,
      tree.renaming,
      tree.pendingCreate,
      tree,
    ]);

    const entryPaths = useMemo<string[]>(() => {
      const out: string[] = [];
      for (const row of rows) if (row.kind === "entry") out.push(row.path);
      return out;
    }, [rows]);

    useEffect(() => {
      if (selectedPath && !entryIndexByPath.has(selectedPath)) {
        setSelectedPath(null);
      }
    }, [entryIndexByPath, selectedPath]);

    const virtualizer = useVirtualizer({
      count: rows.length,
      getScrollElement: () => scrollRef.current,
      estimateSize: () => ROW_HEIGHT,
      overscan: OVERSCAN,
      getItemKey: (index) => rows[index]?.key ?? index,
    });

    const scrollEntryIntoView = useCallback(
      (path: string) => {
        const index = entryIndexByPath.get(path);
        if (index === undefined) return;
        virtualizer.scrollToIndex(index, { align: "auto" });
      },
      [entryIndexByPath, virtualizer],
    );

    const lastSyncedActivePathRef = useRef<string | null>(null);
    useEffect(() => {
      if (
        !activeFilePath ||
        activeFilePath === lastSyncedActivePathRef.current
      ) {
        return;
      }
      if (!entryIndexByPath.has(activeFilePath)) return;
      lastSyncedActivePathRef.current = activeFilePath;
      setSelectedPath(activeFilePath);
      requestAnimationFrame(() => scrollEntryIntoView(activeFilePath));
    }, [activeFilePath, entryIndexByPath, scrollEntryIntoView]);

    useImperativeHandle(
      ref,
      () => ({
        focus: () => {
          containerRef.current?.focus();
          if (!selectedPath && entryPaths.length > 0) {
            const first = entryPaths[0];
            setSelectedPath(first);
            requestAnimationFrame(() => scrollEntryIntoView(first));
          }
        },
        isFocused: () => {
          const c = containerRef.current;
          if (!c) return false;
          const active = document.activeElement;
          return active instanceof Node && c.contains(active);
        },
        focusSearch: () => {
          setIsSearchOpen(true);
          searchRef.current?.focus();
        },
      }),
      [entryPaths, scrollEntryIntoView, selectedPath],
    );

    useGlobalShortcuts({
      "explorer.search": () => {
        if (searchRef.current?.isFocused()) {
          setIsSearchOpen(false);
          return;
        }
        setIsSearchOpen(true);
        searchRef.current?.focus();
      },
    });

    useEffect(() => {
      return () => {
        if (errorTimerRef.current !== null) {
          window.clearTimeout(errorTimerRef.current);
        }
      };
    }, []);

    const showOperationError = useCallback((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      setOperationError(message);
      if (errorTimerRef.current !== null) {
        window.clearTimeout(errorTimerRef.current);
      }
      errorTimerRef.current = window.setTimeout(() => {
        setOperationError(null);
        errorTimerRef.current = null;
      }, 5000);
    }, []);

    const deleteTargetForPath = useCallback(
      (path: string): DeleteTarget | null => {
        const index = entryIndexByPath.get(path);
        const row = index === undefined ? null : rows[index];
        if (!row || (row.kind !== "entry" && row.kind !== "rename"))
          return null;
        return {
          path: row.path,
          name: row.name,
          isDir: row.isDir,
        };
      },
      [entryIndexByPath, rows],
    );

    const requestDeletePath = useCallback(
      (path: string) => {
        const target = deleteTargetForPath(path);
        if (target) setDeleteTarget(target);
      },
      [deleteTargetForPath],
    );

    const confirmDeleteTarget = useCallback(
      async (target: DeleteTarget) => {
        setDeleteTarget(null);
        await tree.deletePath(target.path);
        requestAnimationFrame(() => containerRef.current?.focus());
      },
      [tree],
    );

    const destinationForPath = useCallback(
      (path: string | null): string | null => {
        if (!rootPath) return null;
        if (!path) return rootPath;
        const index = entryIndexByPath.get(path);
        const row = index === undefined ? null : rows[index];
        if (
          row &&
          (row.kind === "entry" || row.kind === "rename") &&
          row.isDir
        ) {
          return path;
        }
        return dirname(path);
      },
      [entryIndexByPath, rootPath, rows],
    );

    const destinationForNativeTarget = useCallback(
      (target: NativePathDropTarget | null): string | null => {
        if (!rootPath || target?.kind !== "explorer") return null;
        if (target.rootPath !== rootPath) return null;
        if (target.fsKind === "root" || !target.path) return rootPath;
        if (target.fsKind === "dir") return target.path;
        return dirname(target.path);
      },
      [rootPath],
    );

    const isDirectoryPath = useCallback(
      (path: string): boolean => {
        const index = entryIndexByPath.get(path);
        const row = index === undefined ? null : rows[index];
        if (!row) return false;
        return (row.kind === "entry" || row.kind === "rename") && row.isDir;
      },
      [entryIndexByPath, rows],
    );

    const resolvePasteDestination = useCallback((): string | null => {
      if (hoveredPath && isDirectoryPath(hoveredPath)) return hoveredPath;
      return destinationForPath(selectedPath);
    }, [destinationForPath, hoveredPath, isDirectoryPath, selectedPath]);

    const pasteFilesInto = useCallback(
      async (destinationDir: string, files: readonly File[]) => {
        for (const file of files) {
          const bytes = await blobBytes(file);
          await tree.writePastedBinary(
            destinationDir,
            pastedFileName(file, new Date()),
            bytes,
          );
        }
      },
      [tree],
    );

    const pastePathsInto = useCallback(
      async (destinationDir: string, paths: readonly string[]) => {
        if (paths.length === 0) return;
        await tree.copyInto(destinationDir, paths);
      },
      [tree],
    );

    const pasteIntoDestination = useCallback(
      async (destinationDir: string, transfer?: DataTransfer | null) => {
        try {
          const files = filesFromDataTransfer(transfer ?? null);
          if (files.length > 0) {
            await pasteFilesInto(destinationDir, files);
            setOperationError(null);
            return;
          }

          const transferText = transfer
            ? transfer.getData("text/uri-list") ||
              transfer.getData("text/plain")
            : "";
          let text = transferText;
          if (!text && !transfer) {
            try {
              text = await navigator.clipboard.readText();
            } catch {
              text = "";
            }
          }

          const paths = parsePathText(text);
          if (paths.length > 0) {
            await pastePathsInto(destinationDir, paths);
            setOperationError(null);
            return;
          }

          const nativePaths = await readNativeClipboardFilePaths();
          if (nativePaths.length > 0) {
            await pastePathsInto(destinationDir, nativePaths);
            setOperationError(null);
            return;
          }

          const snapshot = getFileClipboard();
          if (
            snapshot &&
            (!text || clipboardTextMatchesPaths(text, snapshot.paths))
          ) {
            await pastePathsInto(destinationDir, snapshot.paths);
            setOperationError(null);
          }
        } catch (error) {
          console.error("explorer paste failed:", error);
          showOperationError(error);
        }
      },
      [pasteFilesInto, pastePathsInto, showOperationError],
    );

    const handlePaste = useCallback(
      (event: ReactClipboardEvent<HTMLDivElement>) => {
        pasteEventCounterRef.current += 1;
        if (tree.renaming || tree.pendingCreate || isSearchOpen) return;
        const destination = resolvePasteDestination();
        if (!destination) return;
        event.preventDefault();
        void pasteIntoDestination(destination, event.clipboardData);
      },
      [
        isSearchOpen,
        pasteIntoDestination,
        resolvePasteDestination,
        tree.pendingCreate,
        tree.renaming,
      ],
    );

    const destinationFromEventTarget = useCallback(
      (target: EventTarget | null): string | null => {
        if (!rootPath) return null;
        const element = target instanceof Element ? target : null;
        const row = element?.closest<HTMLElement>("[data-fs-path]") ?? null;
        if (row && containerRef.current?.contains(row)) {
          const path = row.dataset.fsPath ?? null;
          if (!path) return rootPath;
          return row.dataset.fsKind === "dir" ? path : dirname(path);
        }
        return rootPath;
      },
      [rootPath],
    );

    const handleDragOver = useCallback(
      (event: ReactDragEvent<HTMLDivElement>) => {
        if (tree.renaming || tree.pendingCreate) return;
        const destination = destinationFromEventTarget(event.target);
        if (!destination) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
        setDropTargetDir(destination);
      },
      [destinationFromEventTarget, tree.pendingCreate, tree.renaming],
    );

    const handleDragLeave = useCallback(
      (event: ReactDragEvent<HTMLDivElement>) => {
        const next = event.relatedTarget;
        if (next instanceof Node && containerRef.current?.contains(next))
          return;
        setDropTargetDir(null);
      },
      [],
    );

    const handleDrop = useCallback(
      (event: ReactDragEvent<HTMLDivElement>) => {
        if (tree.renaming || tree.pendingCreate) return;
        const destination = destinationFromEventTarget(event.target);
        if (!destination) return;
        event.preventDefault();
        setDropTargetDir(null);
        void pasteIntoDestination(destination, event.dataTransfer);
      },
      [
        destinationFromEventTarget,
        pasteIntoDestination,
        tree.pendingCreate,
        tree.renaming,
      ],
    );

    useEffect(() => {
      if (!rootPath) return;
      const onTarget = (event: Event) => {
        const detail = (event as CustomEvent<NativePathDropEventDetail>).detail;
        if (tree.renaming || tree.pendingCreate) {
          setDropTargetDir(null);
          return;
        }
        setDropTargetDir(destinationForNativeTarget(detail.target));
      };
      const onDrop = (event: Event) => {
        const detail = (event as CustomEvent<NativePathDropEventDetail>).detail;
        if (tree.renaming || tree.pendingCreate) {
          setDropTargetDir(null);
          return;
        }
        const destination = destinationForNativeTarget(detail.target);
        setDropTargetDir(null);
        if (!destination || detail.paths.length === 0) return;
        void pastePathsInto(destination, detail.paths).catch(
          (error: unknown) => {
            console.error("explorer native drop failed:", error);
            showOperationError(error);
          },
        );
      };
      window.addEventListener(NATIVE_PATH_DROP_TARGET_EVENT, onTarget);
      window.addEventListener(NATIVE_PATH_DROP_EVENT, onDrop);
      return () => {
        window.removeEventListener(NATIVE_PATH_DROP_TARGET_EVENT, onTarget);
        window.removeEventListener(NATIVE_PATH_DROP_EVENT, onDrop);
      };
    }, [
      destinationForNativeTarget,
      pastePathsInto,
      rootPath,
      showOperationError,
      tree.pendingCreate,
      tree.renaming,
    ]);

    if (!rootPath) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
          <HugeiconsIcon
            icon={Folder01Icon}
            size={24}
            strokeWidth={1.5}
            className="text-muted-foreground"
          />
          <div className="text-xs text-muted-foreground">
            No current directory
          </div>
        </div>
      );
    }

    const root = tree.nodes[rootPath];
    const pendingAtRoot =
      tree.pendingCreate?.parentPath === rootPath ? tree.pendingCreate : null;

    const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (tree.renaming || tree.pendingCreate || isSearchOpen) return;
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      )
        return;

      const isModifier = e.metaKey || e.ctrlKey;
      if (isModifier && e.key.toLowerCase() === "c") {
        const path = selectedPath ?? rootPath;
        e.preventDefault();
        void copyFilePaths([path]);
        return;
      }
      if (isModifier && e.key.toLowerCase() === "v") {
        const destination = resolvePasteDestination();
        if (!destination) return;
        const pasteEventCount = pasteEventCounterRef.current;
        window.setTimeout(() => {
          if (pasteEventCounterRef.current !== pasteEventCount) return;
          void pasteIntoDestination(destination);
        }, 50);
        return;
      }
      if (!isModifier && e.key === "Delete") {
        if (!selectedPath) return;
        e.preventDefault();
        requestDeletePath(selectedPath);
        return;
      }

      if (entryPaths.length === 0) return;

      const currentIdx = selectedPath ? entryPaths.indexOf(selectedPath) : -1;
      const move = (next: number) => {
        const clamped = Math.max(0, Math.min(entryPaths.length - 1, next));
        const path = entryPaths[clamped];
        setSelectedPath(path);
        requestAnimationFrame(() => scrollEntryIntoView(path));
      };

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          move(currentIdx < 0 ? 0 : currentIdx + 1);
          break;
        case "ArrowUp":
          e.preventDefault();
          move(currentIdx < 0 ? entryPaths.length - 1 : currentIdx - 1);
          break;
        case "ArrowRight": {
          if (currentIdx < 0) return;
          e.preventDefault();
          const path = entryPaths[currentIdx];
          const idx = entryIndexByPath.get(path);
          if (idx === undefined) break;
          const row = rows[idx];
          if (row.kind !== "entry") break;
          if (row.isDir) {
            if (!row.isExpanded) tree.toggle(row.path);
            else move(currentIdx + 1);
          }
          break;
        }
        case "ArrowLeft": {
          if (currentIdx < 0) return;
          e.preventDefault();
          const path = entryPaths[currentIdx];
          const idx = entryIndexByPath.get(path);
          if (idx === undefined) break;
          const row = rows[idx];
          if (row.kind !== "entry") break;
          if (row.isDir && row.isExpanded) {
            tree.toggle(row.path);
          } else {
            const parent = row.path.slice(0, row.path.lastIndexOf("/"));
            if (parent && parent !== rootPath) setSelectedPath(parent);
          }
          break;
        }
        case "Enter": {
          if (currentIdx < 0) return;
          e.preventDefault();
          const path = entryPaths[currentIdx];
          const idx = entryIndexByPath.get(path);
          if (idx === undefined) break;
          const row = rows[idx];
          if (row.kind !== "entry") break;
          if (row.isDir) tree.toggle(row.path);
          else onOpenFile(row.path);
          break;
        }
      }
    };

    const renderRow = (row: Row) => {
      switch (row.kind) {
        case "entry":
        case "rename": {
          return (
            <EntryRow
              path={row.path}
              name={row.name}
              isDir={row.isDir}
              isExpanded={row.kind === "entry" ? row.isExpanded : false}
              depth={row.depth}
              rootPath={rootPath}
              tree={tree}
              isSelected={selectedPath === row.path}
              isRenaming={row.kind === "rename"}
              onOpenFile={onOpenFile}
              onSelectPath={setSelectedPath}
              onRequestExplorerFocus={() => containerRef.current?.focus()}
              onHoverPath={setHoveredPath}
              onPasteInto={(destinationDir) =>
                void pasteIntoDestination(destinationDir)
              }
              onRequestDelete={requestDeletePath}
              isDropTarget={row.isDir && dropTargetDir === row.path}
              onRevealInTerminal={onRevealInTerminal}
              onAttachToAgent={onAttachToAgent}
              onOpenMarkdownPreview={onOpenMarkdownPreview}
            />
          );
        }
        case "pending":
          return (
            <PendingRow
              depth={row.depth}
              kind={row.pendingKind}
              onCommit={tree.commitCreate}
              onCancel={tree.cancelCreate}
            />
          );
        case "status":
          return (
            <StatusRow
              depth={row.depth}
              message={row.message}
              tone={row.tone}
            />
          );
      }
    };

    return (
      <div
        ref={containerRef}
        data-explorer-root={rootPath}
        className="flex h-full flex-col outline-none"
        role="tree"
        aria-label="File explorer"
        tabIndex={0}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <div className="flex h-8 shrink-0 items-center gap-1 border-b border-border/60 px-2">
          <span
            className="flex flex-1 items-center truncate text-xs font-medium text-foreground/80"
            title={rootPath}
          >
            <img
              src={folderIconUrl(basename(rootPath), false)}
              alt=""
              height={15}
              width={15}
              className="mx-1.5"
            />
            {basename(rootPath)}
          </span>

          <Button
            variant="ghost"
            size="icon"
            className="size-6 text-muted-foreground hover:text-foreground"
            onClick={() => setIsSearchOpen((v) => !v)}
            title="Search files"
            aria-label="Search files"
          >
            <HugeiconsIcon icon={Search01Icon} size={13} strokeWidth={2} />
          </Button>

          <Button
            variant="ghost"
            size="icon"
            className="size-6 text-muted-foreground hover:text-foreground"
            onClick={() => tree.beginCreate(rootPath, "file")}
            title="New file"
          >
            <HugeiconsIcon icon={FileAddIcon} size={13} strokeWidth={2} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-6 text-muted-foreground hover:text-foreground"
            onClick={() => tree.beginCreate(rootPath, "dir")}
            title="New folder"
          >
            <HugeiconsIcon icon={FolderAddIcon} size={13} strokeWidth={2} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-6 text-muted-foreground hover:text-foreground"
            onClick={() => tree.refresh(rootPath)}
            title="Refresh"
          >
            <HugeiconsIcon icon={Refresh01Icon} size={12} strokeWidth={2} />
          </Button>
        </div>

        <ExplorerSearch
          ref={searchRef}
          rootPath={rootPath}
          onOpenFile={onOpenFile}
          open={isSearchOpen}
          onRequestClose={() => setIsSearchOpen(false)}
          onActiveChange={setIsSearchActive}
          onRevealInTerminal={onRevealInTerminal}
          onAttachToAgent={onAttachToAgent}
        />

        {!isSearchActive ? (
          <ContextMenu>
            <ContextMenuTrigger asChild>
              <div
                ref={scrollRef}
                data-explorer-scroll="true"
                data-fs-kind="root"
                className={cn(
                  "min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden [scrollbar-gutter:stable]",
                  dropTargetDir === rootPath && "bg-primary/5",
                )}
              >
                {operationError ? (
                  <div className="mx-2 mt-2 rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1 text-[11px] text-destructive">
                    {operationError}
                  </div>
                ) : null}
                {pendingAtRoot ? (
                  <div
                    className="flex h-6 w-full min-w-0 items-center gap-2 px-1.5 text-[13px]"
                    style={{ paddingLeft: 6 }}
                  >
                    <span className="size-3.5 shrink-0" />
                    <img
                      src={
                        pendingAtRoot.kind === "dir"
                          ? folderIconUrl("", false)
                          : fileIconUrl("untitled")
                      }
                      alt=""
                      className="size-4 shrink-0 opacity-70"
                    />
                    <InlineInput
                      initial=""
                      placeholder={
                        pendingAtRoot.kind === "dir" ? "New folder" : "New file"
                      }
                      onCommit={tree.commitCreate}
                      onCancel={tree.cancelCreate}
                    />
                  </div>
                ) : null}
                {root?.status === "loading" && (
                  <div className="px-3 py-2 text-[11px] text-muted-foreground">
                    Loading…
                  </div>
                )}
                {root?.status === "error" && (
                  <div className="px-3 py-2 text-[11px] text-destructive">
                    {root.message}
                  </div>
                )}
                {root?.status === "loaded" ? (
                  <div
                    style={{
                      height: virtualizer.getTotalSize(),
                      position: "relative",
                      width: "100%",
                    }}
                  >
                    {virtualizer.getVirtualItems().map((virtualRow) => {
                      const row = rows[virtualRow.index];
                      if (!row) return null;
                      return (
                        <div
                          key={virtualRow.key}
                          data-virtual-row-index={virtualRow.index}
                          style={{
                            position: "absolute",
                            top: 0,
                            left: 0,
                            width: "100%",
                            height: virtualRow.size,
                            transform: `translateY(${virtualRow.start}px)`,
                          }}
                        >
                          {renderRow(row)}
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            </ContextMenuTrigger>
            <ContextMenuContent
              className={COMPACT_CONTENT}
              onCloseAutoFocus={(e) => {
                if (tree.renaming || tree.pendingCreate) e.preventDefault();
              }}
            >
              {onRevealInTerminal && (
                <ContextMenuItem
                  className={COMPACT_ITEM}
                  onSelect={() => onRevealInTerminal(rootPath)}
                >
                  Open in Terminal
                </ContextMenuItem>
              )}
              <ContextMenuItem
                className={COMPACT_ITEM}
                onSelect={() => void revealInFinder(rootPath)}
              >
                Reveal in Finder
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem
                className={COMPACT_ITEM}
                onSelect={() => tree.beginCreate(rootPath, "file")}
              >
                New File
              </ContextMenuItem>
              <ContextMenuItem
                className={COMPACT_ITEM}
                onSelect={() => tree.beginCreate(rootPath, "dir")}
              >
                New Folder
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem
                className={COMPACT_ITEM}
                onSelect={() => void copyFilePaths([rootPath])}
              >
                Copy
              </ContextMenuItem>
              <ContextMenuItem
                className={COMPACT_ITEM}
                onSelect={() => void pasteIntoDestination(rootPath)}
              >
                Paste
              </ContextMenuItem>
              <ContextMenuItem
                className={COMPACT_ITEM}
                onSelect={() => void copyToClipboard(rootPath)}
              >
                Copy Path
              </ContextMenuItem>
              <ContextMenuItem
                className={COMPACT_ITEM}
                onSelect={() => tree.refresh(rootPath)}
              >
                Refresh
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        ) : null}
        <DeleteConfirmDialog
          target={deleteTarget}
          onOpenChange={(open) => {
            if (!open) setDeleteTarget(null);
          }}
          onConfirm={confirmDeleteTarget}
        />
      </div>
    );
  },
);
