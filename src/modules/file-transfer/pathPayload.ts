export type PathPayloadSource =
  | "browser-drop"
  | "browser-paste"
  | "clipboard-text"
  | "in-app"
  | "native-drop";

export type PathPayload = {
  kind: "paths";
  source: PathPayloadSource;
  paths: string[];
};

export type ClipboardFilePayload = {
  kind: "files";
  source: "browser-drop" | "browser-paste";
  files: File[];
};

const IMAGE_EXTENSIONS = new Set([
  "avif",
  "bmp",
  "gif",
  "heic",
  "heif",
  "ico",
  "jpeg",
  "jpg",
  "png",
  "svg",
  "tif",
  "tiff",
  "webp",
]);

const IMAGE_MEDIA_TYPE_EXTENSIONS: Readonly<Record<string, string>> = {
  "image/avif": "avif",
  "image/bmp": "bmp",
  "image/gif": "gif",
  "image/heic": "heic",
  "image/heif": "heif",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/svg+xml": "svg",
  "image/tiff": "tiff",
  "image/webp": "webp",
};

const WINDOWS_RESERVED_NAMES = new Set([
  "con",
  "prn",
  "aux",
  "nul",
  "com1",
  "com2",
  "com3",
  "com4",
  "com5",
  "com6",
  "com7",
  "com8",
  "com9",
  "lpt1",
  "lpt2",
  "lpt3",
  "lpt4",
  "lpt5",
  "lpt6",
  "lpt7",
  "lpt8",
  "lpt9",
]);

export function filesFromClipboardEvent(
  event: Pick<ClipboardEvent, "clipboardData">,
): File[] {
  return filesFromDataTransfer(event.clipboardData);
}

export function filesFromDataTransfer(
  dataTransfer: DataTransfer | null,
): File[] {
  if (!dataTransfer) return [];
  const files = Array.from(dataTransfer.files);
  if (files.length === 0) {
    for (const item of Array.from(dataTransfer.items)) {
      if (item.kind !== "file") continue;
      const file = item.getAsFile();
      if (file) files.push(file);
    }
  }
  return files.filter((file) => file.size > 0 || file.name);
}

export function imageFilesFromDataTransfer(
  dataTransfer: DataTransfer | null,
): File[] {
  return filesFromDataTransfer(dataTransfer).filter((file) =>
    isImageBlob(file, file.name),
  );
}

export function textFromClipboardEvent(
  event: Pick<ClipboardEvent, "clipboardData">,
): string {
  return event.clipboardData?.getData("text/plain") ?? "";
}

export function isImageBlob(blob: Blob, name?: string): boolean {
  if (blob.type.toLowerCase().startsWith("image/")) return true;
  if (!name) return false;
  const ext = extensionFromName(name);
  return ext !== null && IMAGE_EXTENSIONS.has(ext.toLowerCase());
}

export function imageExtensionForMediaType(mediaType: string): string {
  return IMAGE_MEDIA_TYPE_EXTENSIONS[mediaType.toLowerCase()] ?? "png";
}

export function isImagePath(path: string): boolean {
  const ext = extensionFromName(path);
  return ext !== null && IMAGE_EXTENSIONS.has(ext.toLowerCase());
}

export function imageMediaTypeForName(name: string): string {
  const ext = extensionFromName(name)?.toLowerCase();
  switch (ext) {
    case "avif":
      return "image/avif";
    case "bmp":
      return "image/bmp";
    case "gif":
      return "image/gif";
    case "heic":
      return "image/heic";
    case "heif":
      return "image/heif";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "svg":
      return "image/svg+xml";
    case "tif":
    case "tiff":
      return "image/tiff";
    case "webp":
      return "image/webp";
    default:
      return "image/png";
  }
}

export function usableFileName(name: string | null | undefined): string | null {
  if (!name) return null;
  const trimmed = sanitizeFileName(name);
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();
  if (lower === "image.png" || lower === "clipboard.png") return null;
  return trimmed;
}

export function sanitizeFileName(name: string): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-")
    .replace(/[. ]+$/g, "")
    .trim();
  if (!cleaned) return "";
  const base = cleaned.split(".")[0]?.toLowerCase() ?? cleaned.toLowerCase();
  return WINDOWS_RESERVED_NAMES.has(base) ? `${cleaned}-file` : cleaned;
}

export function generatedPastedImageName(now: Date, mediaType: string): string {
  return `pasted-image-${formatTimestamp(now)}.${imageExtensionForMediaType(mediaType)}`;
}

export function parsePathText(text: string): string[] {
  const trimmed = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  if (!trimmed) return [];

  const uriCandidates = parseUriList(trimmed);
  if (uriCandidates.length > 0) return uniquePaths(uriCandidates);

  const lines = trimmed
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));

  if (lines.length > 1) {
    return uniquePaths(lines.map(unwrapPathToken).filter(isAbsolutePathLike));
  }

  const line = lines[0];
  if (!line) return [];
  const tokens = tokenizePathText(line).map(unwrapPathToken);
  if (tokens.length > 1 && tokens.every(isAbsolutePathLike)) {
    return uniquePaths(tokens);
  }

  const singlePath = unwrapPathToken(line);
  if (isAbsolutePathLike(singlePath)) return [singlePath];
  return [];
}

export function isAbsolutePathLike(path: string): boolean {
  return (
    /^file:\/\//i.test(path) ||
    /^[A-Za-z]:[\\/]/.test(path) ||
    path.startsWith("/") ||
    path.startsWith("\\\\")
  );
}

export function extensionFromName(name: string): string | null {
  const base = name.split(/[\\/]/).pop() ?? name;
  const index = base.lastIndexOf(".");
  if (index <= 0 || index === base.length - 1) return null;
  return base.slice(index + 1);
}

function parseUriList(text: string): string[] {
  const candidates = text
    .split(/[\n\t ]+/)
    .map((token) => token.trim())
    .filter((token) => token && !token.startsWith("#"));
  const paths: string[] = [];
  for (const token of candidates) {
    if (!/^file:\/\//i.test(token)) continue;
    const path = fileUrlToPath(token);
    if (path) paths.push(path);
  }
  return paths;
}

function fileUrlToPath(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "file:") return null;
    const pathname = decodeURIComponent(url.pathname);
    if (url.hostname) return `//${url.hostname}${pathname}`;
    return pathname.replace(/^\/([A-Za-z]:[\\/])/, "$1");
  } catch {
    return null;
  }
}

function tokenizePathText(text: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }
  if (current) tokens.push(current);
  return tokens;
}

function unwrapPathToken(token: string): string {
  const trimmed = token.trim();
  if (trimmed.length < 2) return trimmed;
  const first = trimmed[0];
  const last = trimmed[trimmed.length - 1];
  if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function uniquePaths(paths: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const path of paths) {
    if (!path || seen.has(path)) continue;
    seen.add(path);
    out.push(path);
  }
  return out;
}

function formatTimestamp(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}
