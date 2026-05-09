// src/lib/sops/audit.test.ts
import { describe, expect, test } from "bun:test";
import type { SopAuditLogEntry } from "@/types/sops";
import { buildAuditSummary } from "./audit";

function makeEntry(overrides: Partial<SopAuditLogEntry>): SopAuditLogEntry {
  return {
    id: "entry-1",
    occurredAt: "2026-05-08T14:32:11Z",
    actorId: "actor-1",
    sopId: "sop-1",
    action: "upload",
    titleAtAction: "Boarding Procedure",
    audienceAtAction: "shared",
    newStoragePath: null,
    newFilename: null,
    newMimeType: null,
    newFileSizeBytes: null,
    supersededStoragePath: null,
    supersededFilename: null,
    prevTitle: null,
    prevDescription: null,
    nextDescription: null,
    prevAudience: null,
    ...overrides,
  };
}

describe("buildAuditSummary", () => {
  test("upload includes filename and audience label", () => {
    expect(
      buildAuditSummary(
        makeEntry({
          action: "upload",
          newFilename: "procedure-v2.pdf",
          audienceAtAction: "shared",
        })
      )
    ).toBe("Uploaded procedure-v2.pdf (Shared)");
  });

  test("upload uses 'Management only' label when audience is management_only", () => {
    expect(
      buildAuditSummary(
        makeEntry({
          action: "upload",
          newFilename: "internal.pdf",
          audienceAtAction: "management_only",
        })
      )
    ).toBe("Uploaded internal.pdf (Management only)");
  });

  test("replace_file shows superseded → new", () => {
    expect(
      buildAuditSummary(
        makeEntry({
          action: "replace_file",
          newFilename: "procedure-v2.pdf",
          supersededFilename: "procedure-v1.pdf",
        })
      )
    ).toBe("Replaced procedure-v1.pdf with procedure-v2.pdf");
  });

  test("edit_metadata renders title diff", () => {
    expect(
      buildAuditSummary(
        makeEntry({
          action: "edit_metadata",
          titleAtAction: "New Title",
          prevTitle: "Old Title",
          prevDescription: "old desc",
          nextDescription: "old desc",
        })
      )
    ).toBe('Title: "Old Title" → "New Title"');
  });

  test("edit_metadata reports description-only change", () => {
    expect(
      buildAuditSummary(
        makeEntry({
          action: "edit_metadata",
          titleAtAction: "Same Title",
          prevTitle: "Same Title",
          prevDescription: "old desc",
          nextDescription: "new desc",
        })
      )
    ).toBe("Description updated");
  });

  test("edit_metadata combines title and description changes", () => {
    expect(
      buildAuditSummary(
        makeEntry({
          action: "edit_metadata",
          titleAtAction: "New Title",
          prevTitle: "Old Title",
          prevDescription: "old desc",
          nextDescription: "new desc",
        })
      )
    ).toBe('Title: "Old Title" → "New Title"; description updated');
  });

  test("visibility_change shows audience transition", () => {
    expect(
      buildAuditSummary(
        makeEntry({
          action: "visibility_change",
          audienceAtAction: "management_only",
          prevAudience: "shared",
        })
      )
    ).toBe("Audience: Shared → Management only");
  });

  test("delete names the file in force at deletion", () => {
    expect(
      buildAuditSummary(
        makeEntry({
          action: "delete",
          supersededFilename: "procedure-v3.pdf",
        })
      )
    ).toBe("Deleted procedure-v3.pdf");
  });
});
