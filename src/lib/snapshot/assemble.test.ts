import { describe, expect, test } from "bun:test";
import { assembleDashboardEntry } from "./assemble";
import type { ScheduleEntry } from "@/types/schedule";

const baseEntry = (date: string): ScheduleEntry => ({
  date,
  dayOfWeek: "Mon",
  confirmationStatus: "confirmed",
  teakNight: false,
  activity: "Studio",
  location: "LA",
  coPilot: "",
  flightInfo: "",
  departure: { airport: "", fbo: "", time: "" },
  arrival: { airport: "", fbo: "", time: "" },
  internationalPax: "",
  groundTransport: "",
  lodging: "",
  comments: "",
  rowId: "row1",
});

describe("assembleDashboardEntry", () => {
  test("returns null when no schedule row exists for the date", () => {
    const entry = assembleDashboardEntry("2026-04-28", {
      schedule: [baseEntry("2026-04-29")],
      transitionsByDate: new Map(),
      assignmentsByDate: new Map(),
      travelLegsByDate: new Map(),
      settingsMap: new Map(),
    });
    expect(entry).toBeNull();
  });

  test("merges all sources for the date", () => {
    const entry = assembleDashboardEntry("2026-04-28", {
      schedule: [baseEntry("2026-04-28")],
      transitionsByDate: new Map([
        ["2026-04-28", [{ person: "greg", title: "Studio", startsAt: "2026-04-28T09:00-07:00", tz: "America/Los_Angeles", eventId: "e1" }]],
      ]),
      assignmentsByDate: new Map([
        ["2026-04-28", [{ id: "u1", fullName: "Alice", email: "a@x" }]],
      ]),
      travelLegsByDate: new Map([
        ["2026-04-28", { pickup: { date: "2026-04-28", action: "Pick up", location: "LAX", time: "9am", companion: "", companionPrePositionFlight: "", teakFlight: "", companionReturnFlight: "" } }],
      ]),
      settingsMap: new Map([["2026-04-28", { detailLevel: "dual" }]]),
    });
    expect(entry).not.toBeNull();
    expect(entry!.detailLevel).toBe("dual");
    expect(entry!.assignedEpos).toHaveLength(1);
    expect(entry!.transitions).toHaveLength(1);
    expect(entry!.pickupLeg?.location).toBe("LAX");
    expect(entry!.dropoffLeg).toBeUndefined();
  });

  test("uses 'single' as the default detail level", () => {
    const entry = assembleDashboardEntry("2026-04-28", {
      schedule: [baseEntry("2026-04-28")],
      transitionsByDate: new Map(),
      assignmentsByDate: new Map(),
      travelLegsByDate: new Map(),
      settingsMap: new Map(),
    });
    expect(entry!.detailLevel).toBe("single");
  });
});
