import {
  NATIVE_PATH_DROP_EVENT,
  NATIVE_PATH_DROP_TARGET_EVENT,
  useNativePathDropRouter,
  type NativePathDropEventDetail,
  type NativePathDropTarget,
} from "@/modules/file-transfer/useNativePathDropRouter";
import { useTerminalDropStore } from "./dropStore";
import { formatDroppedPaths } from "./quoteShellPath";
import { pasteIntoLeaf } from "./rendererPool";

function emitNativePathDropEvent(
  eventName:
    | typeof NATIVE_PATH_DROP_EVENT
    | typeof NATIVE_PATH_DROP_TARGET_EVENT,
  target: NativePathDropTarget | null,
  paths: readonly string[],
): void {
  const detail: NativePathDropEventDetail = { target, paths: [...paths] };
  window.dispatchEvent(new CustomEvent(eventName, { detail }));
}

/** Wires native OS file drops into the target under the cursor. Terminal drops
 * keep the existing bracketed shell-quoted paste behavior; other targets receive
 * shared DOM events so modules stay decoupled. */
export function useTerminalFileDrop(): void {
  useNativePathDropRouter({
    onTargetChange: (target, paths) => {
      useTerminalDropStore
        .getState()
        .setTarget(target?.kind === "terminal" ? target.leafId : null);
      emitNativePathDropEvent(NATIVE_PATH_DROP_TARGET_EVENT, target, paths);
    },
    onDrop: (target, paths) => {
      useTerminalDropStore.getState().setTarget(null);
      if (target?.kind === "terminal" && paths.length > 0) {
        pasteIntoLeaf(target.leafId, formatDroppedPaths([...paths]));
      }
      emitNativePathDropEvent(NATIVE_PATH_DROP_EVENT, target, paths);
    },
    onLeave: () => {
      useTerminalDropStore.getState().setTarget(null);
      emitNativePathDropEvent(NATIVE_PATH_DROP_TARGET_EVENT, null, []);
    },
    onError: (error) => {
      console.error("[terax] drag-drop listen failed:", error);
    },
  });
}
