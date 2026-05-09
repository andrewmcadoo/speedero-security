// src/lib/sops/storage.test.ts
import { describe, expect, test } from "bun:test";
import {
  buildUploadSlug,
  buildSopFilePath,
  deriveBaseName,
  SOPS_BUCKET,
} from "./storage";

describe("buildUploadSlug", () => {
  test("formats UTC timestamp as YYYYMMDDTHHMMSSZ with no separators", () => {
    const d = new Date("2026-05-08T14:32:11.123Z");
    expect(buildUploadSlug(d)).toBe("20260508T143211Z");
  });

  test("zero-pads single-digit components", () => {
    const d = new Date("2026-01-02T03:04:05.000Z");
    expect(buildUploadSlug(d)).toBe("20260102T030405Z");
  });

  test("uses UTC regardless of local timezone", () => {
    // The Date constructor parses 'Z' as UTC; getUTC* methods stay UTC,
    // so the slug is timezone-independent. This guards against a future
    // refactor that switches to getHours()/getMonth() etc.
    const d = new Date("2026-05-08T23:59:59Z");
    expect(buildUploadSlug(d)).toBe("20260508T235959Z");
  });
});

describe("buildSopFilePath", () => {
  test("path is sopId/slug/basename-v{N}.{ext}", () => {
    expect(buildSopFilePath("abc-123", "20260508T143211Z", "procedure", 1, "pdf")).toBe(
      "abc-123/20260508T143211Z/procedure-v1.pdf"
    );
    expect(buildSopFilePath("abc-123", "20260508T143211Z", "procedure", 3, "docx")).toBe(
      "abc-123/20260508T143211Z/procedure-v3.docx"
    );
  });
});

describe("deriveBaseName", () => {
  test("strips the extension", () => {
    expect(deriveBaseName("procedure.pdf")).toBe("procedure");
    expect(deriveBaseName("manual.docx")).toBe("manual");
  });

  test("collapses whitespace and slashes into dashes", () => {
    expect(deriveBaseName("My SOP File.pdf")).toBe("My-SOP-File");
    expect(deriveBaseName("a/b/c.pdf")).toBe("a-b-c");
  });

  test("empty result falls back to 'untitled'", () => {
    expect(deriveBaseName(".pdf")).toBe("untitled");
    expect(deriveBaseName("")).toBe("untitled");
  });

  test("preserves filenames without an extension", () => {
    expect(deriveBaseName("README")).toBe("README");
  });
});

describe("SOPS_BUCKET", () => {
  test("matches the bucket id from migration 012", () => {
    expect(SOPS_BUCKET).toBe("sops");
  });
});
