import { useEffect, useState, useSyncExternalStore } from "react";

/**
 * Godown phone app helpers (/floor). Godown Wi-Fi drops; scans are remembered on the phone so a
 * blip never loses what was scanned, and screens show when the connection is down.
 */

function subscribeOnline(cb: () => void) {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
}
export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );
}

/** A localStorage-backed list that tolerates private mode and full storage. */
export function useStoredList<T>(key: string, max = 50): [T[], (next: T[]) => void] {
  const [items, setItems] = useState<T[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(key) ?? "[]") as T[];
    } catch {
      return [];
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(items.slice(0, max)));
    } catch {
      /* storage unavailable — keep in memory */
    }
  }, [key, items, max]);
  return [items, (next) => setItems(next.slice(0, max))];
}

export interface RecentScan {
  barcode: string;
  at: string;
  description?: string;
}

/** Short haptic + click so the operator knows a scan registered without looking. */
export function scanFeedback(ok: boolean) {
  try {
    navigator.vibrate?.(ok ? 40 : [80, 60, 80]);
  } catch {
    /* not supported */
  }
}
