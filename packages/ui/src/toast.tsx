import { Toast as RToast } from "radix-ui";
import { type ReactNode, createContext, useCallback, useContext, useMemo, useState } from "react";
import { cn } from "./cn.js";
import type { Tone } from "./status.js";

interface ToastItem {
  id: number;
  title: ReactNode;
  description?: ReactNode;
  tone: Tone;
  action?: { label: string; onClick: () => void };
}

type Notify = (toast: Omit<ToastItem, "id" | "tone"> & { tone?: Tone }) => void;

const ToastContext = createContext<Notify | null>(null);

const rule: Record<Tone, string> = {
  neutral: "border-l-ink-3",
  positive: "border-l-positive",
  caution: "border-l-caution",
  critical: "border-l-critical",
  info: "border-l-info",
  accent: "border-l-accent",
};

/** Quiet notices in the bottom-right corner; a coloured left rule carries the tone. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const notify = useCallback<Notify>((toast) => {
    setItems((current) => [...current, { id: Date.now() + Math.random(), tone: "neutral", ...toast }]);
  }, []);
  const value = useMemo(() => notify, [notify]);

  return (
    <ToastContext.Provider value={value}>
      <RToast.Provider swipeDirection="right" duration={5000}>
        {children}
        {items.map((item) => (
          <RToast.Root
            key={item.id}
            onOpenChange={(open) => {
              if (!open) setItems((current) => current.filter((t) => t.id !== item.id));
            }}
            className={cn(
              "flex items-start gap-4 rounded-sm border border-l-2 border-rule bg-sheet px-4 py-3 shadow-sheet",
              "data-[state=open]:animate-[rise-in_180ms_var(--ease-out)]",
              rule[item.tone],
            )}
          >
            <div className="min-w-0 flex-1">
              <RToast.Title className="text-sm font-medium text-ink">{item.title}</RToast.Title>
              {item.description ? <RToast.Description className="mt-0.5 text-xs text-ink-2">{item.description}</RToast.Description> : null}
            </div>
            {item.action ? (
              <RToast.Action altText={item.action.label} onClick={item.action.onClick} className="text-xs font-medium text-accent hover:underline">
                {item.action.label}
              </RToast.Action>
            ) : null}
            <RToast.Close aria-label="Dismiss" className="text-ink-3 hover:text-ink">
              ×
            </RToast.Close>
          </RToast.Root>
        ))}
        <RToast.Viewport className="fixed bottom-4 right-4 z-[60] flex w-[380px] max-w-[calc(100vw-2rem)] flex-col gap-2 outline-none" />
      </RToast.Provider>
    </ToastContext.Provider>
  );
}

export function useToast(): Notify {
  const notify = useContext(ToastContext);
  if (!notify) throw new Error("useToast() must be used inside <ToastProvider>");
  return notify;
}
