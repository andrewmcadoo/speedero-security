import { describe, expect, test } from "bun:test";
import type { sheets_v4 } from "googleapis";
import { isShaded } from "./google-sheets";

function cell(
  backgroundColor?: sheets_v4.Schema$Color
): sheets_v4.Schema$CellData {
  return backgroundColor
    ? { effectiveFormat: { backgroundColor } }
    : { effectiveFormat: {} };
}

describe("isShaded", () => {
  test("undefined cell → not shaded", () => {
    expect(isShaded(undefined)).toBe(false);
  });

  test("no effectiveFormat → not shaded", () => {
    expect(isShaded({})).toBe(false);
  });

  test("no backgroundColor → not shaded", () => {
    expect(isShaded(cell())).toBe(false);
  });

  test("white fill (default no-fill) → not shaded", () => {
    expect(isShaded(cell({ red: 1, green: 1, blue: 1 }))).toBe(false);
  });

  test("green fill → shaded", () => {
    expect(isShaded(cell({ red: 0, green: 1, blue: 0 }))).toBe(true);
  });

  test("yellow fill → shaded", () => {
    expect(isShaded(cell({ red: 1, green: 1, blue: 0 }))).toBe(true);
  });

  test("light gray fill → shaded", () => {
    expect(isShaded(cell({ red: 0.9, green: 0.9, blue: 0.9 }))).toBe(true);
  });
});
