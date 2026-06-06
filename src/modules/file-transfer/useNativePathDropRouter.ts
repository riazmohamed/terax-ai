import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useEffect, useRef } from "react";
import type { DragDropEvent } from "@tauri-apps/api/webview";

export type NativePathDropTarget =
  | { kind: "terminal"; leafId: number }
  | { kind: "ai-input" }
  | {
      kind: "explorer";
      rootPath: string;
      path: string | null;
      fsKind: "file" | "dir" | "root" | "symlink";
    };

export const NATIVE_PATH_DROP_TARGET_EVENT = "terax:native-path-drop-target";
export const NATIVE_PATH_DROP_EVENT = "terax:native-path-drop";

export type NativePathDropEventDetail = {
  target: NativePathDropTarget | null;
  paths: string[];
};

export type NativePathDropRouterHandlers = {
  onTargetChange?: (
    target: NativePathDropTarget | null,
    paths: readonly string[],
  ) => void;
  onDrop?: (
    target: NativePathDropTarget | null,
    paths: readonly string[],
  ) => void;
  onLeave?: () => void;
  onError?: (error: unknown) => void;
};

export function useNativePathDropRouter(
  handlers: NativePathDropRouterHandlers,
): void {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;

    const listen = async (): Promise<void> => {
      try {
        const fn = await getCurrentWebview().onDragDropEvent((event) => {
          routeDragDropEvent(event.payload, handlersRef.current);
        });
        if (disposed) fn();
        else unlisten = fn;
      } catch (error) {
        handlersRef.current.onError?.(error);
      }
    };
    void listen();

    return () => {
      disposed = true;
      unlisten?.();
      handlersRef.current.onLeave?.();
    };
  }, []);
}

export function routeDragDropEvent(
  event: DragDropEvent,
  handlers: NativePathDropRouterHandlers,
): void {
  if (event.type === "leave") {
    handlers.onTargetChange?.(null, []);
    handlers.onLeave?.();
    return;
  }

  const target = nativePathDropTargetAt(event.position.x, event.position.y);
  if (event.type === "enter" || event.type === "over") {
    handlers.onTargetChange?.(target, "paths" in event ? event.paths : []);
    return;
  }

  handlers.onTargetChange?.(null, []);
  handlers.onDrop?.(target, event.paths);
}

export function nativePathDropTargetAt(
  nativeX: number,
  nativeY: number,
): NativePathDropTarget | null {
  const point = nativePointToClientPoint(nativeX, nativeY);
  const element = document.elementFromPoint(point.x, point.y);
  if (!element) return null;

  const terminal = element.closest<HTMLElement>("[data-pane-leaf]");
  if (terminal) {
    const leafId = Number(terminal.dataset.paneLeaf);
    return Number.isFinite(leafId) ? { kind: "terminal", leafId } : null;
  }

  if (element.closest("[data-ai-input-bar]")) return { kind: "ai-input" };

  const explorerRoot = element.closest<HTMLElement>("[data-explorer-root]");
  if (!explorerRoot) return null;
  const rootPath = explorerRoot.dataset.explorerRoot;
  if (!rootPath) return null;

  const row = element.closest<HTMLElement>("[data-fs-path]");
  if (row && explorerRoot.contains(row)) {
    const fsKind = toFsKind(row.dataset.fsKind);
    return {
      kind: "explorer",
      rootPath,
      path: row.dataset.fsPath ?? null,
      fsKind,
    };
  }

  return { kind: "explorer", rootPath, path: null, fsKind: "root" };
}

export function nativePointToClientPoint(
  nativeX: number,
  nativeY: number,
): { x: number; y: number } {
  if (nativeX <= window.innerWidth && nativeY <= window.innerHeight) {
    return { x: nativeX, y: nativeY };
  }
  const dpr = window.devicePixelRatio || 1;
  return { x: nativeX / dpr, y: nativeY / dpr };
}

function toFsKind(value: string | undefined): "file" | "dir" | "symlink" {
  if (value === "dir" || value === "symlink") return value;
  return "file";
}
