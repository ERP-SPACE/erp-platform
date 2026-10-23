import { X } from "lucide-react";
import {
  Dialog as RDialog,
  DropdownMenu as RMenu,
  Popover as RPopover,
  Tabs as RTabs,
  Tooltip as RTooltip,
} from "radix-ui";
import type { LucideIcon } from "lucide-react";
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

const widths = { sm: "max-w-md", md: "max-w-lg", lg: "max-w-2xl" };

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
        <RDialog.Overlay className="fixed inset-0 z-40 bg-[rgb(16_24_40/0.45)] data-[state=open]:animate-[fade-in_150ms_ease-out]" />
        <RDialog.Content
          className={cn(
            "fixed left-1/2 top-[12vh] z-50 w-[calc(100vw-2rem)] -translate-x-1/2 rounded-xl border border-border bg-surface shadow-pop",
            "data-[state=open]:animate-[rise-in_180ms_var(--ease-out)]",
            widths[width],
          )}
        >
          <div className="flex items-start justify-between gap-4 px-6 pb-2 pt-5">
            <div>
              <RDialog.Title className="text-lg font-semibold text-fg">{title}</RDialog.Title>
              {description ? (
                <RDialog.Description className="mt-1 text-sm text-fg-2">
                  {description}
                </RDialog.Description>
              ) : (
                <RDialog.Description className="sr-only">
                  {typeof title === "string" ? title : "Dialog"}
                </RDialog.Description>
              )}
            </div>
            <RDialog.Close asChild>
              <Button variant="ghost" size="sm" iconOnly icon={X} aria-label="Close" />
            </RDialog.Close>
          </div>
          {children ? <div className="px-6 py-3">{children}</div> : null}
          {footer ? (
            <div className="flex justify-end gap-2 rounded-b-xl border-t border-border bg-muted/50 px-6 py-3">
              {footer}
            </div>
          ) : null}
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}

/** Side panel for quick view and edit without leaving the list. */
export function Drawer({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  width = "md",
}: DialogProps) {
  const w = { sm: "max-w-sm", md: "max-w-lg", lg: "max-w-2xl" }[width];
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <RDialog.Portal>
        <RDialog.Overlay className="fixed inset-0 z-40 bg-[rgb(16_24_40/0.35)] data-[state=open]:animate-[fade-in_150ms_ease-out]" />
        <RDialog.Content
          className={cn(
            "fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-border bg-surface shadow-pop",
            "data-[state=open]:animate-[slide-in-right_200ms_var(--ease-out)]",
            w,
          )}
        >
          <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-4">
            <div className="min-w-0">
              <RDialog.Title className="truncate text-lg font-semibold text-fg">
                {title}
              </RDialog.Title>
              {description ? (
                <RDialog.Description className="mt-0.5 text-sm text-fg-2">
                  {description}
                </RDialog.Description>
              ) : (
                <RDialog.Description className="sr-only">
                  {typeof title === "string" ? title : "Panel"}
                </RDialog.Description>
              )}
            </div>
            <RDialog.Close asChild>
              <Button variant="ghost" size="sm" iconOnly icon={X} aria-label="Close" />
            </RDialog.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">{children}</div>
          {footer ? (
            <div className="flex justify-end gap-2 border-t border-border bg-muted/50 px-6 py-3">
              {footer}
            </div>
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
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
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
          className="z-50 rounded-lg border border-border bg-surface p-4 shadow-pop"
        >
          {children}
        </RPopover.Content>
      </RPopover.Portal>
    </RPopover.Root>
  );
}

export interface MenuItem {
  label: string;
  icon?: LucideIcon;
  onSelect: () => void;
  tone?: "default" | "danger";
  disabled?: boolean;
}

/** Row-actions / overflow menu. */
export function DropdownMenu({
  trigger,
  items,
  align = "end",
  header,
}: {
  trigger: ReactNode;
  items: (MenuItem | "separator")[];
  align?: "start" | "end";
  header?: ReactNode;
}) {
  return (
    <RMenu.Root>
      <RMenu.Trigger asChild>{trigger}</RMenu.Trigger>
      <RMenu.Portal>
        <RMenu.Content
          align={align}
          sideOffset={6}
          className="z-50 min-w-48 rounded-lg border border-border bg-surface p-1 shadow-pop"
        >
          {header ? <div className="px-2.5 py-2">{header}</div> : null}
          {items.map((item, index) =>
            item === "separator" ? (
              <RMenu.Separator key={`sep-${index}`} className="my-1 h-px bg-border" />
            ) : (
              <RMenu.Item
                key={item.label}
                disabled={item.disabled}
                onSelect={item.onSelect}
                className={cn(
                  "flex h-8 cursor-default select-none items-center gap-2 rounded-md px-2.5 text-sm outline-none",
                  "data-[highlighted]:bg-muted data-[disabled]:opacity-50",
                  item.tone === "danger" ? "text-danger" : "text-fg",
                )}
              >
                {item.icon ? <item.icon className="size-4 text-fg-3" aria-hidden /> : null}
                {item.label}
              </RMenu.Item>
            ),
          )}
        </RMenu.Content>
      </RMenu.Portal>
    </RMenu.Root>
  );
}

export function Tooltip({ content, children }: { content: ReactNode; children: ReactNode }) {
  return (
    <RTooltip.Provider delayDuration={300}>
      <RTooltip.Root>
        <RTooltip.Trigger asChild>{children}</RTooltip.Trigger>
        <RTooltip.Portal>
          <RTooltip.Content
            sideOffset={6}
            className="z-50 rounded-md bg-fg px-2.5 py-1.5 text-xs font-medium text-canvas shadow-pop"
          >
            {content}
          </RTooltip.Content>
        </RTooltip.Portal>
      </RTooltip.Root>
    </RTooltip.Provider>
  );
}

/** Underline tabs for record pages (Customer 360, Salesman, Settings sections). */
export function Tabs({
  value,
  onValueChange,
  tabs,
}: {
  value: string;
  onValueChange: (value: string) => void;
  tabs: { value: string; label: ReactNode; count?: number; content: ReactNode }[];
}) {
  return (
    <RTabs.Root value={value} onValueChange={onValueChange}>
      <RTabs.List className="flex gap-6 overflow-x-auto border-b border-border">
        {tabs.map((tab) => (
          <RTabs.Trigger
            key={tab.value}
            value={tab.value}
            className="-mb-px inline-flex items-center gap-2 whitespace-nowrap border-b-2 border-transparent pb-2.5 pt-1 text-sm font-medium text-fg-3 transition-colors hover:text-fg data-[state=active]:border-primary data-[state=active]:text-primary"
          >
            {tab.label}
            {tab.count !== undefined ? (
              <span className="rounded-full bg-muted px-1.5 text-xs text-fg-2">{tab.count}</span>
            ) : null}
          </RTabs.Trigger>
        ))}
      </RTabs.List>
      {tabs.map((tab) => (
        <RTabs.Content key={tab.value} value={tab.value} className="pt-6 outline-none">
          {tab.content}
        </RTabs.Content>
      ))}
    </RTabs.Root>
  );
}
