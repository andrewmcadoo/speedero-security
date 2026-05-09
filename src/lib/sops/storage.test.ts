// src/lib/sops/storage.test.ts
import { describe, expect, test } from "bun:test";
import {
  buildUploadSlug,
  buildOriginalPath,
  buildPdfPath,
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

describe("buildOriginalPath / buildPdfPath", () => {
  test("original path includes sop id, slug, and extension", () => {
    expect(buildOriginalPath("abc-123", "20260508T143211Z", "docx")).toBe(
      "abc-123/20260508T143211Z/original.docx"
    );
    expect(buildOriginalPath("abc-123", "20260508T143211Z", "pdf")).toBe(
      "abc-123/20260508T143211Z/original.pdf"
    );
  });

  test("pdf path always uses document.pdf", () => {
    expect(buildPdfPath("abc-123", "20260508T143211Z")).toBe(
      "abc-123/20260508T143211Z/document.pdf"
    );
  });
});

describe("SOPS_BUCKET", () => {
  test("matches the bucket id from migration 012", () => {
    expect(SOPS_BUCKET).toBe("sops");
  });
});
