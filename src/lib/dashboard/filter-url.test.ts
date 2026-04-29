import { describe, expect, test } from "bun:test";
import { readFilterFromSearch, nextFilterSearch } from "./filter-url";

describe("readFilterFromSearch", () => {
  test("returns 'all' when no filter param", () => {
    expect(readFilterFromSearch("")).toBe("all");
    expect(readFilterFromSearch("foo=bar")).toBe("all");
  });

  test("returns the filter value when present", () => {
    expect(readFilterFromSearch("filter=this-week")).toBe("this-week");
    expect(readFilterFromSearch("a=1&filter=unassigned&b=2")).toBe("unassigned");
  });

  test("returns 'all' when filter is unrecognized", () => {
    expect(readFilterFromSearch("filter=garbage")).toBe("all");
  });

  test("returns 'all' when both range and filter are set (range wins)", () => {
    // Mirrors the existing rule in dashboard-filters: a custom range zeroes out the filter pill.
    expect(readFilterFromSearch("start=2026-04-01&end=2026-04-30&filter=this-week")).toBe("all");
    expect(readFilterFromSearch("date=2026-04-15&filter=this-week")).toBe("all");
  });
});

describe("nextFilterSearch", () => {
  test("setting 'all' removes the filter param", () => {
    expect(nextFilterSearch("filter=this-week", "all")).toBe("");
    expect(nextFilterSearch("a=1&filter=this-week&b=2", "all")).toBe("a=1&b=2");
  });

  test("setting a non-all value writes the filter param", () => {
    expect(nextFilterSearch("", "this-week")).toBe("filter=this-week");
    expect(nextFilterSearch("a=1", "unassigned")).toBe("a=1&filter=unassigned");
  });

  test("changing the filter overwrites the existing filter param", () => {
    expect(nextFilterSearch("filter=this-week", "next-week")).toBe("filter=next-week");
  });

  test("clears range params (start, end, date) when a pill is chosen", () => {
    // Picking a pill should reset any custom range — matches existing behavior.
    expect(nextFilterSearch("start=2026-04-01&end=2026-04-30", "this-week")).toBe("filter=this-week");
    expect(nextFilterSearch("date=2026-04-15", "all")).toBe("");
    expect(nextFilterSearch("start=2026-04-01&filter=next-week", "this-week")).toBe("filter=this-week");
  });
});
