import { describe, expect, test } from "bun:test";
import { buildDetailChangeEmail } from "./detail-change-notification";
import type { ScheduleEntry } from "@/types/schedule";

const sampleEntry: ScheduleEntry = {
  date: "2026-05-12",
  dayOfWeek: "Tuesday",
  confirmationStatus: "confirmed",
  teakNight: false,
  activity: "Site visit — Reno",
  location: "Reno, NV",
  coPilot: "",
  flightInfo: "",
  departure: { airport: "KVNY", fbo: "Signature", time: "08:30" },
  arrival: { airport: "KRNO", fbo: "Atlantic", time: "10:15" },
  internationalPax: "",
  groundTransport: "",
  lodging: "",
  comments: "",
  rowId: "row-12",
};

describe("buildDetailChangeEmail", () => {
  test("subject includes date and new level label", () => {
    const result = buildDetailChangeEmail({
      date: "2026-05-12",
      oldLevel: "single",
      newLevel: "dual",
      scheduleEntry: sampleEntry,
      changedByName: "Jane Manager",
      appUrl: "https://secapp.speedero.com",
    });
    expect(result.subject).toBe("Detail changed for 2026-05-12: Dual");
  });

  test("text body includes changed-by name, both levels, and schedule fields", () => {
    const result = buildDetailChangeEmail({
      date: "2026-05-12",
      oldLevel: "single",
      newLevel: "dual_day",
      scheduleEntry: sampleEntry,
      changedByName: "Jane Manager",
      appUrl: "https://secapp.speedero.com",
    });
    expect(result.text).toContain("Jane Manager");
    expect(result.text).toContain("New detail: Dual (Day Only)");
    expect(result.text).toContain("Previous:   Single");
    expect(result.text).toContain("Site visit — Reno");
    expect(result.text).toContain("Reno, NV");
    expect(result.text).toContain("KVNY Signature @ 08:30");
    expect(result.text).toContain("KRNO Atlantic @ 10:15");
    expect(result.text).toContain("Confirmation: confirmed");
    expect(result.text).toContain("Teak Night:   no");
    expect(result.text).toContain(
      "https://secapp.speedero.com/dashboard?date=2026-05-12"
    );
  });

  test("html body contains the same key facts as text body", () => {
    const result = buildDetailChangeEmail({
      date: "2026-05-12",
      oldLevel: "none",
      newLevel: "single",
      scheduleEntry: sampleEntry,
      changedByName: "Jane Manager",
      appUrl: "https://secapp.speedero.com",
    });
    expect(result.html).toContain("Jane Manager");
    expect(result.html).toContain("Single");
    expect(result.html).toContain("None");
    expect(result.html).toContain("Site visit — Reno");
    expect(result.html).toContain("KVNY");
    expect(result.html).toContain(
      "https://secapp.speedero.com/dashboard?date=2026-05-12"
    );
  });

  test("missing schedule entry collapses to a single line", () => {
    const result = buildDetailChangeEmail({
      date: "2026-05-12",
      oldLevel: "single",
      newLevel: "dual",
      scheduleEntry: null,
      changedByName: "Jane Manager",
      appUrl: "https://secapp.speedero.com",
    });
    expect(result.text).toContain("No schedule entry for this date.");
    expect(result.text).not.toContain("Activity:");
    expect(result.html).toContain("No schedule entry for this date.");
  });

  test("blank schedule fields render as em-dash", () => {
    const blank: ScheduleEntry = {
      ...sampleEntry,
      activity: "",
      location: "",
      departure: { airport: "", fbo: "", time: "" },
      arrival: { airport: "", fbo: "", time: "" },
    };
    const result = buildDetailChangeEmail({
      date: "2026-05-12",
      oldLevel: "single",
      newLevel: "dual",
      scheduleEntry: blank,
      changedByName: "Jane Manager",
      appUrl: "https://secapp.speedero.com",
    });
    expect(result.text).toContain("Activity:     —");
    expect(result.text).toContain("Location:     —");
    expect(result.text).toContain("Departure:    —");
    expect(result.text).toContain("Arrival:      —");
  });

  test("teak night true renders 'yes'", () => {
    const result = buildDetailChangeEmail({
      date: "2026-05-12",
      oldLevel: "single",
      newLevel: "dual",
      scheduleEntry: { ...sampleEntry, teakNight: true },
      changedByName: "Jane Manager",
      appUrl: "https://secapp.speedero.com",
    });
    expect(result.text).toContain("Teak Night:   yes");
  });

  test("change to none uses None label", () => {
    const result = buildDetailChangeEmail({
      date: "2026-05-12",
      oldLevel: "dual",
      newLevel: "none",
      scheduleEntry: sampleEntry,
      changedByName: "Jane Manager",
      appUrl: "https://secapp.speedero.com",
    });
    expect(result.subject).toBe("Detail changed for 2026-05-12: None");
    expect(result.text).toContain("New detail: None");
    expect(result.text).toContain("Previous:   Dual");
  });

  test("empty appUrl omits the dashboard link line", () => {
    const result = buildDetailChangeEmail({
      date: "2026-05-12",
      oldLevel: "single",
      newLevel: "dual",
      scheduleEntry: sampleEntry,
      changedByName: "Jane Manager",
      appUrl: "",
    });
    expect(result.text).not.toContain("Open dashboard");
    expect(result.html).not.toContain("Open dashboard");
  });
});
