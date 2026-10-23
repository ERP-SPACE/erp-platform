import { Command } from "cmdk";
import { Dialog as RDialog } from "radix-ui";
import { type ReactNode, useEffect } from "react";
import { Kbd } from "./button.js";
import { cn } from "./cn.js";

export interface CommandItem {
  id: string;
  label: string;
  group: string;
  hint?: ReactNode;
  keywords?: string[];
  shortcut?: string;
  onRun: () => void;
}

/** ⌘/Ctrl K palette (brief B1.4): go to, create, find — the fastest way around the ERP. */
export function CommandPalette({
  open,
  onOpenChange,
  items,
  placeholder = "Go to, create, or find…",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: CommandItem[];
  placeholder?: string;
}) {
  const groups = [...new Set(items.map((i) => i.group))];
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <RDialog.Portal>
        <RDialog.Overlay className="fixed inset-0 z-40 bg-[rgb(16_24_40/0.45)]" />
        <RDialog.Content className="fixed left-1/2 top-[14vh] z-50 w-[calc(100vw-2rem)] max-w-xl -translate-x-1/2 overflow-hidden rounded-xl border border-border bg-surface shadow-pop">
          <RDialog.Title className="sr-only">Command palette</RDialog.Title>
          <RDialog.Description className="sr-only">Search pages and actions</RDialog.Description>
          <Command loop label="Command palette">
            <Command.Input
              autoFocus
              placeholder={placeholder}
              className="h-12 w-full border-b border-border bg-transparent px-4 text-base text-fg outline-none placeholder:text-fg-3"
            />
            <Command.List className="max-h-[50vh] overflow-auto p-2">
              <Command.Empty className="px-3 py-6 text-center text-sm text-fg-3">
                Nothing matches.
              </Command.Empty>
              {groups.map((group) => (
                <Command.Group
                  key={group}
                  heading={group}
                  className="[&_[cmdk-group-heading]]:label-caps [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-3"
                >
                  {items
                    .filter((item) => item.group === group)
                    .map((item) => (
                      <Command.Item
                        key={item.id}
                        value={`${item.label} ${item.keywords?.join(" ") ?? ""}`}
                        onSelect={() => {
                          onOpenChange(false);
                          item.onRun();
                        }}
                        className={cn(
                          "flex h-9 cursor-default items-center justify-between gap-3 rounded-md px-3 text-sm text-fg",
                          "data-[selected=true]:bg-primary-soft data-[selected=true]:text-primary",
                        )}
                      >
                        <span>{item.label}</span>
                        <span className="flex items-center gap-2 text-xs text-fg-3">
                          {item.hint}
                          {item.shortcut ? <Kbd>{item.shortcut}</Kbd> : null}
                        </span>
                      </Command.Item>
                    ))}
                </Command.Group>
              ))}
            </Command.List>
          </Command>
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}

export interface Shortcut {
  keys: string;
  label: string;
  group: string;
}

/** `?` overlay listing the shortcuts available on the current screen. */
export function ShortcutOverlay({
  open,
  onOpenChange,
  shortcuts,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shortcuts: Shortcut[];
}) {
  const groups = [...new Set(shortcuts.map((s) => s.group))];
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <RDialog.Portal>
        <RDialog.Overlay className="fixed inset-0 z-40 bg-[rgb(16_24_40/0.45)]" />
        <RDialog.Content className="fixed left-1/2 top-[14vh] z-50 w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 rounded-xl border border-border bg-surface p-6 shadow-pop">
          <RDialog.Title className="text-lg font-semibold text-fg">
            Keyboard shortcuts
          </RDialog.Title>
          <RDialog.Description className="sr-only">
            Shortcuts available on this screen
          </RDialog.Description>
          <div className="mt-4 grid gap-5">
            {groups.map((group) => (
              <section key={group}>
                <h3 className="label-caps mb-2">{group}</h3>
                <dl className="grid gap-1.5">
                  {shortcuts
                    .filter((s) => s.group === group)
                    .map((s) => (
                      <div
                        key={s.keys + s.label}
                        className="flex items-center justify-between border-b border-border pb-1.5 text-sm"
                      >
                        <dt className="text-fg">{s.label}</dt>
                        <dd className="flex gap-1">
                          {s.keys.split(" ").map((k) => (
                            <Kbd key={k}>{k}</Kbd>
                          ))}
                        </dd>
                      </div>
                    ))}
                </dl>
              </section>
            ))}
          </div>
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

/**
 * Global key bindings. Single keys are ignored while typing in a field; "mod+k" means ⌘K on
 * macOS and Ctrl+K elsewhere.
 */
export function useHotkeys(
  bindings: Record<string, (event: KeyboardEvent) => void>,
  enabled = true,
): void {
  useEffect(() => {
    if (!enabled) return;
    const handler = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;
      for (const [combo, run] of Object.entries(bindings)) {
        const parts = combo.toLowerCase().split("+");
        const key = parts.at(-1);
        const wantsMod = parts.includes("mod");
        const wantsShift = parts.includes("shift");
        const wantsAlt = parts.includes("alt");
        if (wantsMod !== mod || wantsAlt !== event.altKey) continue;
        if (wantsShift && !event.shiftKey) continue;
        if (event.key.toLowerCase() !== key) continue;
        if (!wantsMod && isTyping(event.target)) continue;
        event.preventDefault();
        run(event);
        return;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [bindings, enabled]);
}
