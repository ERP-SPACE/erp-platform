/**
 * Job schedules (ADR-0005). Cron patterns are evaluated in IST by BullMQ (tz option).
 * Analytics refresh: every 3 minutes from 08:00 to 20:00, every 30 minutes otherwise; nightly
 * backup 01:30; audit archival monthly.
 */
export const TZ = "Asia/Kolkata";

export interface ScheduleEntry {
  id: string;
  job: JobName;
  pattern: string;
}

export const JOB_NAMES = [
  "system.heartbeat",
  "audit.ensure-partitions",
  "idempotency.purge-expired",
  "analytics.refresh",
  "db.backup",
  "audit.archive",
] as const;
export type JobName = (typeof JOB_NAMES)[number];

export function buildSchedule(options: {
  businessMinutes: number;
  offHoursMinutes: number;
  businessStartHour: number;
  businessEndHour: number;
}): ScheduleEntry[] {
  const {
    businessMinutes,
    offHoursMinutes,
    businessStartHour: start,
    businessEndHour: end,
  } = options;
  if (start >= end) throw new Error("Business hours must start before they end");
  const offHours = [start > 0 ? `0-${start - 1}` : null, end <= 23 ? `${end}-23` : null]
    .filter(Boolean)
    .join(",");
  return [
    { id: "heartbeat", job: "system.heartbeat", pattern: "* * * * *" },
    { id: "audit-partitions", job: "audit.ensure-partitions", pattern: "15 1 * * *" },
    { id: "idempotency-purge", job: "idempotency.purge-expired", pattern: "5 * * * *" },
    // Stage 6: nightly backup at 01:30 IST; audit months archived on the 1st at 02:45 (Q45).
    { id: "db-backup", job: "db.backup", pattern: "30 1 * * *" },
    { id: "audit-archive", job: "audit.archive", pattern: "45 2 1 * *" },
    {
      id: "analytics-business",
      job: "analytics.refresh",
      pattern: `*/${businessMinutes} ${start}-${end - 1} * * *`,
    },
    ...(offHours
      ? [
          {
            id: "analytics-off-hours",
            job: "analytics.refresh" as const,
            pattern: `*/${offHoursMinutes} ${offHours} * * *`,
          },
        ]
      : []),
  ];
}
