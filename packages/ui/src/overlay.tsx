import { Dialog as RDialog, Popover as RPopover, Tabs as RTabs } from "radix-ui";
import type { ReactNode } from "react";
import { Button } from "./button.js";
import { cn } from "./cn.js";

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  width?: "sm" | "md" | "lg";
}

const widths = { sm: "max-w-sm", md: "max-w-lg", lg: "max-w-2xl" };

/** A modal sheet: paper surface, serif title, hairline-separated footer. */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  width = "md",
}: DialogProps) {
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <RDialog.Portal>
        <RDialog.Overlay className="fixed inset-0 z-40 bg-ink/25 backdrop-blur-[1px] data-[state=open]:animate-[fade-in_150ms_ease-out]" />
        <RDialog.Content
          className={cn(
            "fixed left-1/2 top-[12vh] z-50 w-[calc(100vw-2rem)] -translate-x-1/2 rounded-sm border border-rule bg-sheet shadow-sheet",
            "data-[state=open]:animate-[rise-in_180ms_var(--ease-out)]",
            widths[width],
          )}
        >
          <div className="px-6 pb-4 pt-5">
            <RDialog.Title className="font-serif text-lg text-ink">{title}</RDialog.Title>
            {description ? (
              <RDialog.Description className="mt-1 text-sm text-ink-2">
                {description}
              </RDialog.Description>
            ) : (
              <RDialog.Description className="sr-only">
                {typeof title === "string" ? title : "Dialog"}
              </RDialog.Description>
            )}
          </div>
          {children ? <div className="px-6 pb-5">{children}</div> : null}
          {footer ? (
            <div className="flex justify-end gap-2 border-t border-rule px-6 py-3">{footer}</div>
          ) : null}
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  tone = "primary",
  busy,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel?: string;
  tone?: "primary" | "danger";
  busy?: boolean;
  onConfirm: () => void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      width="sm"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant={tone} busy={busy} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    />
  );
}

export function Popover({
  trigger,
  children,
  align = "start",
}: {
  trigger: ReactNode;
  children: ReactNode;
  align?: "start" | "center" | "end";
}) {
  return (
    <RPopover.Root>
      <RPopover.Trigger asChild>{trigger}</RPopover.Trigger>
      <RPopover.Portal>
        <RPopover.Content
          align={align}
          sideOffset={6}
          className="z-50 rounded-sm border border-rule-strong bg-sheet p-3 shadow-sheet"
        >
          {children}
        </RPopover.Content>
      </RPopover.Portal>
    </RPopover.Root>
  );
}

/** Underlined tabs set in small caps — like section markers in a ledger. */
export function Tabs({
  value,
  onValueChange,
  tabs,
}: {
  value: string;
  onValueChange: (value: string) => void;
  tabs: { value: string; label: ReactNode; content: ReactNode }[];
}) {
  return (
    <RTabs.Root value={value} onValueChange={onValueChange}>
      <RTabs.List className="flex gap-6 border-b border-rule">
        {tabs.map((tab) => (
          <RTabs.Trigger
            key={tab.value}
            value={tab.value}
            className="smallcaps -mb-px border-b-2 border-transparent pb-2 pt-1 transition-colors hover:text-ink data-[state=active]:border-accent data-[state=active]:text-ink"
          >
            {tab.label}
          </RTabs.Trigger>
        ))}
      </RTabs.List>
      {tabs.map((tab) => (
        <RTabs.Content key={tab.value} value={tab.value} className="pt-5 outline-none">
          {tab.content}
        </RTabs.Content>
      ))}
    </RTabs.Root>
  );
}
