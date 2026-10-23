import { describe, expect, it } from "vitest";
import { buildSchedule } from "../src/schedule.js";

describe("job schedule (ADR-0005)", () => {
  it("refreshes analytics every 3 min 08:00–20:00 IST and every 30 min otherwise", () => {
    const schedule = buildSchedule({
      businessMinutes: 3,
      offHoursMinutes: 30,
      businessStartHour: 8,
      businessEndHour: 20,
    });
    const analytics = schedule.filter((s) => s.job === "analytics.refresh").map((s) => s.pattern);
    expect(analytics).toEqual(["*/3 8-19 * * *", "*/30 0-7,20-23 * * *"]);
  });

  it("handles business hours that start at midnight", () => {
    const schedule = buildSchedule({
      businessMinutes: 5,
      offHoursMinutes: 60,
      businessStartHour: 0,
      businessEndHour: 20,
    });
    expect(schedule.find((s) => s.id === "analytics-off-hours")?.pattern).toBe("*/60 20-23 * * *");
  });

  it("rejects inverted hours", () => {
    expect(() =>
      buildSchedule({
        businessMinutes: 3,
        offHoursMinutes: 30,
        businessStartHour: 20,
        businessEndHour: 8,
      }),
    ).toThrow();
  });

  it("keeps audit partitions and housekeeping scheduled", () => {
    const ids = buildSchedule({
      businessMinutes: 3,
      offHoursMinutes: 30,
      businessStartHour: 8,
      businessEndHour: 20,
    }).map((s) => s.id);
    expect(ids).toEqual(
      expect.arrayContaining(["heartbeat", "audit-partitions", "idempotency-purge"]),
    );
  });
});
