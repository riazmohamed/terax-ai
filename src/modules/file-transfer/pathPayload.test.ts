import { describe, expect, it } from "vitest";
import {
  generatedPastedImageName,
  imageMediaTypeForName,
  isAbsolutePathLike,
  isImagePath,
  parsePathText,
  sanitizeFileName,
} from "./pathPayload";

describe("parsePathText", () => {
  it("parses newline separated absolute paths", () => {
    expect(parsePathText("/tmp/a.txt\n/tmp/b.txt")).toEqual([
      "/tmp/a.txt",
      "/tmp/b.txt",
    ]);
  });

  it("parses quoted Windows paths separated by spaces", () => {
    expect(
      parsePathText('"C:\\Users\\me\\A File.txt" "D:\\images\\b.png"'),
    ).toEqual(["C:\\Users\\me\\A File.txt", "D:\\images\\b.png"]);
  });

  it("parses file URI lists", () => {
    expect(
      parsePathText("file:///C:/Users/me/a.txt\nfile:///tmp/b.txt"),
    ).toEqual(["C:/Users/me/a.txt", "/tmp/b.txt"]);
  });

  it("rejects ordinary prose", () => {
    expect(parsePathText("please open src/App.tsx later")).toEqual([]);
  });
});

describe("path helpers", () => {
  it("recognizes absolute path shapes", () => {
    expect(isAbsolutePathLike("/tmp/a")).toBe(true);
    expect(isAbsolutePathLike("C:/Users/me/a")).toBe(true);
    expect(isAbsolutePathLike("relative/file.txt")).toBe(false);
  });

  it("recognizes image paths and media types", () => {
    expect(isImagePath("/tmp/photo.webp")).toBe(true);
    expect(isImagePath("/tmp/photo.txt")).toBe(false);
    expect(imageMediaTypeForName("photo.jpg")).toBe("image/jpeg");
  });

  it("sanitizes unsafe pasted names", () => {
    expect(sanitizeFileName("bad:name?.png")).toBe("bad-name-.png");
    expect(sanitizeFileName("con")).toBe("con-file");
  });

  it("generates deterministic pasted image names from a clock", () => {
    expect(
      generatedPastedImageName(new Date("2026-06-05T04:03:02"), "image/png"),
    ).toBe("pasted-image-20260605-040302.png");
  });
});
