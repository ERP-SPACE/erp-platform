import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Toast as RToast } from "radix-ui";
import { type ReactNode, createContext, useCallback, useContext, useState } from "react";
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

const icons: Record<Tone, { icon: LucideIcon; className: string }> = {
  neutral: { icon: Info, className: "text-fg-3" },
  primary: { icon: Info, className: "text-primary" },
  info: { icon: Info, className: "text-info" },
  success: { icon: CheckCircle2, className: "text-success" },
  warning: { icon: AlertTriangle, className: "text-warning" },
  danger: { icon: XCircle, className: "text-danger" },
};

/** Notifications in the bottom-right corner. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const notify = useCallback<Notify>((toast) => {
    setItems((current) => [
      ...current,
      { id: Date.now() + Math.random(), tone: "neutral", ...toast },
    ]);
  }, []);

  return (
    <ToastContext.Provider value={notify}>
      <RToast.Provider swipeDirection="right" duration={5000}>
        {children}
        {items.map((item) => {
          const { icon: Icon, className } = icons[item.tone];
          return (
            <RToast.Root
              key={item.id}
              onOpenChange={(open) => {
                if (!open) setItems((current) => current.filter((t) => t.id !== item.id));
              }}
              className="flex items-start gap-3 rounded-lg border border-border bg-surface p-4 shadow-pop data-[state=open]:animate-[rise-in_180ms_var(--ease-out)]"
            >
              <Icon className={cn("mt-0.5 size-5 shrink-0", className)} aria-hidden />
              <div className="min-w-0 flex-1">
                <RToast.Title className="text-sm font-semibold text-fg">{item.title}</RToast.Title>
                {item.description ? (
                  <RToast.Description className="mt-0.5 text-sm text-fg-2">
                    {item.description}
                  </RToast.Description>
                ) : null}
                {item.action ? (
                  <RToast.Action
                    altText={item.action.label}
                    onClick={item.action.onClick}
                    className="mt-2 cursor-pointer text-sm font-semibold text-primary hover:underline"
                  >
                    {item.action.label}
                  </RToast.Action>
                ) : null}
              </div>
              <RToast.Close aria-label="Dismiss" className="cursor-pointer rounded-sm text-fg-3 hover:text-fg">
                <X className="size-4" />
              </RToast.Close>
            </RToast.Root>
          );
        })}
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
