import type { RealtimeTopic } from "@erp/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { keys } from "./queries.js";

const INVALIDATES: Record<RealtimeTopic, readonly (readonly unknown[])[]> = {
  "settings.changed": [keys.settings, keys.company, keys.me],
  "series.changed": [keys.series],
  "users.changed": [keys.users, keys.roles, keys.me],
  "catalogue.changed": [keys.catalogue, keys.dashboard],
  "customers.changed": [keys.customers, keys.dashboard],
  "suppliers.changed": [keys.suppliers, keys.dashboard],
  "transporters.changed": [keys.transporters],
  "salesmen.changed": [keys.salesmen, keys.customers],
  "purchase.changed": [keys.purchase, keys.inventory, keys.dashboard],
  "inventory.changed": [keys.inventory, keys.dashboard],
  "sales.changed": [keys.sales, keys.inventory, keys.customers, keys.dashboard],
};

export type SyncState = "connecting" | "live" | "offline";

/**
 * Subscribes to /api/events (SSE) and invalidates the matching queries, so screens other people
 * are editing update within seconds (ADR-0005). EventSource reconnects on its own.
 */
export function useRealtime(enabled: boolean): SyncState {
  const queryClient = useQueryClient();
  const [state, setState] = useState<SyncState>("connecting");

  useEffect(() => {
    if (!enabled) return;
    const source = new EventSource("/api/events", { withCredentials: true });
    source.onopen = () => setState("live");
    source.onerror = () =>
      setState(source.readyState === EventSource.CLOSED ? "offline" : "connecting");
    const listeners = (Object.keys(INVALIDATES) as RealtimeTopic[]).map((topic) => {
      const listener = () => {
        for (const queryKey of INVALIDATES[topic]) void queryClient.invalidateQueries({ queryKey });
      };
      source.addEventListener(topic, listener);
      return () => source.removeEventListener(topic, listener);
    });
    return () => {
      listeners.forEach((off) => off());
      source.close();
    };
  }, [enabled, queryClient]);

  return enabled ? state : "offline";
}
