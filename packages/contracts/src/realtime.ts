/**
 * Server-sent event topics (ADR-0005). The web app maps each topic to the query keys it
 * invalidates. Payloads stay small: ids and versions, never full records.
 */
export const REALTIME_TOPICS = ["settings.changed", "series.changed", "users.changed"] as const;
export type RealtimeTopic = (typeof REALTIME_TOPICS)[number];

export interface RealtimeEvent<T = Record<string, unknown>> {
  topic: RealtimeTopic;
  companyId: string;
  at: string;
  by: string | null;
  data: T;
}
