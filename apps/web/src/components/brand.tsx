import { Layers } from "lucide-react";
import { cn } from "@erp/ui";

/** Product mark used in the sidebar and on sign-in. */
export function BrandMark({ inverted, compact }: { inverted?: boolean; compact?: boolean }) {
  return (
    <span className="relative inline-flex items-center gap-2.5">
      <span
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-lg",
          inverted ? "bg-white text-[#1f4fd8]" : "bg-primary text-primary-fg",
        )}
      >
        <Layers className="size-[18px]" strokeWidth={2.25} />
      </span>
      {compact ? null : (
        <span
          className={cn(
            "text-base font-semibold tracking-tight",
            inverted ? "text-white" : "text-fg",
          )}
        >
          Paper<span className={inverted ? "text-white/70" : "text-primary"}>ERP</span>
        </span>
      )}
    </span>
  );
}
