import { describe, expect, test } from "bun:test";
import { stripTransitionPrefix } from "./google-calendar";

describe("stripTransitionPrefix", () => {
  test("strips standard 'TT: ' prefix", () => {
    expect(stripTransitionPrefix("TT: Studio")).toBe("Studio");
  });

  test("is case-insensitive", () => {
    expect(stripTransitionPrefix("tt: home")).toBe("home");
    expect(stripTransitionPrefix("Tt: airport")).toBe("airport");
  });

  test("accepts no whitespace after colon", () => {
    expect(stripTransitionPrefix("TT:Studio")).toBe("Studio");
  });

  test("accepts multiple spaces after colon", () => {
    expect(stripTransitionPrefix("TT:   Office")).toBe("Office");
  });

  test("trims trailing whitespace", () => {
    expect(stripTransitionPrefix("TT: Studio   ")).toBe("Studio");
  });

  test("returns null for non-matching titles", () => {
    expect(stripTransitionPrefix("Studio")).toBeNull();
    expect(stripTransitionPrefix("Matt: meeting")).toBeNull(); // contains TT: as substring but not at start
  });

  test("returns null when title is just the prefix with empty body", () => {
    expect(stripTransitionPrefix("TT:")).toBeNull();
    expect(stripTransitionPrefix("TT:   ")).toBeNull();
    expect(stripTransitionPrefix("  TT:  ")).toBeNull();
  });

  test("accepts leading whitespace before prefix", () => {
    expect(stripTransitionPrefix("  TT: Office")).toBe("Office");
  });
});
