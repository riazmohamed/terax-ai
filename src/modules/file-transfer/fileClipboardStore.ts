export type FileClipboardSnapshot = {
  paths: string[];
  copiedAt: number;
};

type Listener = (snapshot: FileClipboardSnapshot | null) => void;

let snapshot: FileClipboardSnapshot | null = null;
const listeners = new Set<Listener>();

export function setFileClipboard(
  paths: readonly string[],
  copiedAt: number = Date.now(),
): FileClipboardSnapshot | null {
  const uniquePaths = uniqueNonEmpty(paths);
  snapshot = uniquePaths.length > 0 ? { paths: uniquePaths, copiedAt } : null;
  emit();
  return snapshot;
}

export function getFileClipboard(): FileClipboardSnapshot | null {
  return snapshot
    ? { paths: [...snapshot.paths], copiedAt: snapshot.copiedAt }
    : null;
}

export function clearFileClipboard(): void {
  if (!snapshot) return;
  snapshot = null;
  emit();
}

export function subscribeFileClipboard(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit(): void {
  const current = getFileClipboard();
  for (const listener of listeners) listener(current);
}

function uniqueNonEmpty(paths: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const path of paths) {
    const trimmed = path.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}
