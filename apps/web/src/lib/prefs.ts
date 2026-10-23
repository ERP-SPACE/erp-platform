import { useSyncExternalStore } from "react";

export type Theme = "system" | "light" | "dark";
export type Density = "comfortable" | "compact";
export interface Prefs {
  theme: Theme;
  density: Density;
}

const KEY = "erp:prefs";
const listeners = new Set<() => void>();
let current: Prefs = read();

function read(): Prefs {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Prefs>;
    return { theme: stored.theme ?? "system", density: stored.density ?? "comfortable" };
  } catch {
    return { theme: "system", density: "comfortable" };
  }
}

function apply(prefs: Prefs): void {
  document.documentElement.dataset.theme = prefs.theme;
  document.documentElement.dataset.density = prefs.density;
}

/** Per-viewer display preferences (theme, density) — kept in localStorage, applied to <html>. */
export function setPrefs(patch: Partial<Prefs>): void {
  current = { ...current, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* private mode: preference just won't persist */
  }
  apply(current);
  listeners.forEach((l) => l());
}

export function usePrefs(): Prefs {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
  );
}
