import { describe, expect, test } from "bun:test";
import { selectMissingSnapshots } from "./invariants";

describe("selectMissingSnapshots", () => {
  test("no missing when every mirror date has a snapshot", () => {
    expect(
      selectMissingSnapshots(
        ["2026-06-20", "2026-06-21"],
        new Set(["2026-06-20", "2026-06-21", "2026-06-22"])
      )
    ).toEqual([]);
  });

  test("returns mirror dates lacking a snapshot, sorted", () => {
    expect(
      selectMissingSnapshots(
        ["2026-06-22", "2026-06-20", "2026-06-21"],
        new Set(["2026-06-21"])
      )
    ).toEqual(["2026-06-20", "2026-06-22"]);
  });

  test("dedupes repeated mirror dates", () => {
    expect(
      selectMissingSnapshots(["2026-06-20", "2026-06-20"], new Set())
    ).toEqual(["2026-06-20"]);
  });

  test("empty mirror → no missing", () => {
    expect(selectMissingSnapshots([], new Set(["2026-06-20"]))).toEqual([]);
  });
});
