import { imageMediaTypeForName } from "@/modules/file-transfer/pathPayload";
import { currentWorkspaceEnv } from "@/modules/workspace";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";

type Status =
  | { kind: "loading" }
  | { kind: "ready"; url: string }
  | { kind: "error"; message: string };

type Props = {
  path: string;
  visible: boolean;
};

function bytesToDataUrl(bytes: readonly number[], mediaType: string): string {
  const chunkSize = 0x8000;
  let binary = "";
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.slice(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return `data:${mediaType};base64,${btoa(binary)}`;
}

export function ImagePreviewPane({ path, visible }: Props) {
  const [status, setStatus] = useState<Status>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    setStatus({ kind: "loading" });
    invoke<number[]>("fs_read_binary_file", {
      path,
      workspace: currentWorkspaceEnv(),
    })
      .then((bytes) => {
        if (cancelled) return;
        const mediaType = imageMediaTypeForName(path);
        setStatus({ kind: "ready", url: bytesToDataUrl(bytes, mediaType) });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setStatus({
          kind: "error",
          message: e instanceof Error ? e.message : String(e),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

  if (!visible && status.kind === "loading") return null;

  return (
    <div className="flex h-full w-full items-center justify-center overflow-auto bg-background/60 p-4">
      {status.kind === "loading" ? (
        <span className="text-[12px] text-muted-foreground">Loading…</span>
      ) : status.kind === "error" ? (
        <span className="text-[12px] text-destructive">
          Failed to load image: {status.message}
        </span>
      ) : (
        <img
          src={status.url}
          alt={path}
          className="max-h-full max-w-full object-contain"
          draggable={false}
        />
      )}
    </div>
  );
}
