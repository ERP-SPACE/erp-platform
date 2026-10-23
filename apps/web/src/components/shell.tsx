import type { MeResponse } from "@erp/contracts";
import {
  Button,
  CommandPalette,
  type CommandItem,
  Kbd,
  Popover,
  Segmented,
  ShortcutOverlay,
  type Shortcut,
  cn,
  useHotkeys,
} from "@erp/ui";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { type ReactNode, useMemo, useState } from "react";
import { authClient } from "../lib/auth.js";
import { type Density, type Theme, setPrefs, usePrefs } from "../lib/prefs.js";
import { can } from "../lib/queries.js";
import { type SyncState, useRealtime } from "../lib/realtime.js";

interface Section {
  label: string;
  to?: string;
  stage?: number;
  permission?: string;
}

/** Left rail sections (brief B3). Sections without a route show the stage that builds them. */
const SECTIONS: Section[] = [
  { label: "Today", to: "/" },
  { label: "Sales", stage: 3 },
  { label: "Purchase", stage: 2 },
  { label: "Stock", stage: 2 },
  { label: "Parties", stage: 1 },
  { label: "Collections", stage: 4 },
  { label: "Reports", stage: 5 },
  { label: "Settings", to: "/settings", permission: "settings.view" },
];

const SHORTCUTS: Shortcut[] = [
  { keys: "Ctrl K", label: "Command palette — go to, create, find", group: "Everywhere" },
  { keys: "?", label: "Show these shortcuts", group: "Everywhere" },
  { keys: "Ctrl .", label: "Toggle compact density", group: "Everywhere" },
  { keys: "↑ ↓", label: "Move through a register", group: "Registers" },
  { keys: "Enter", label: "Open the selected row", group: "Registers" },
  { keys: "Esc", label: "Close a dialog or go back", group: "Sheets" },
];

export function Shell({ me, children }: { me: MeResponse; children: ReactNode }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const prefs = usePrefs();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const sync = useRealtime(true);
  const path = useRouterState({ select: (s) => s.location.pathname });

  const signOut = async () => {
    await authClient.signOut();
    queryClient.clear();
    await navigate({ to: "/login" });
  };

  const commands = useMemo<CommandItem[]>(() => {
    const go = (to: string) => () => void navigate({ to });
    const items: CommandItem[] = [{ id: "today", group: "Go to", label: "Today", onRun: go("/") }];
    if (can(me, "settings.view")) {
      items.push(
        {
          id: "company",
          group: "Settings",
          label: "Company GST profile",
          keywords: ["gstin", "bank", "address"],
          onRun: go("/settings/company"),
        },
        {
          id: "general",
          group: "Settings",
          label: "General settings",
          keywords: ["widths", "tolerance", "rounding", "gsm"],
          onRun: go("/settings/general"),
        },
      );
    }
    if (can(me, "settings.series.view")) {
      items.push({
        id: "series",
        group: "Settings",
        label: "Document number series",
        keywords: ["invoice number", "SI", "PO"],
        onRun: go("/settings/series"),
      });
    }
    if (can(me, "users.view")) {
      items.push({
        id: "users",
        group: "Settings",
        label: "Users & roles",
        keywords: ["permissions", "access"],
        onRun: go("/settings/users"),
      });
    }
    if (can(me, "audit.view")) {
      items.push({
        id: "audit",
        group: "Settings",
        label: "Audit log",
        keywords: ["history", "changes"],
        onRun: go("/settings/audit"),
      });
    }
    items.push(
      {
        id: "theme-light",
        group: "Display",
        label: "Use light theme",
        onRun: () => setPrefs({ theme: "light" }),
      },
      {
        id: "theme-dark",
        group: "Display",
        label: "Use dark theme (Night Ledger)",
        onRun: () => setPrefs({ theme: "dark" }),
      },
      {
        id: "theme-system",
        group: "Display",
        label: "Follow system theme",
        onRun: () => setPrefs({ theme: "system" }),
      },
      {
        id: "density",
        group: "Display",
        label: "Toggle compact density",
        shortcut: "Ctrl .",
        onRun: () => setPrefs({ density: prefs.density === "compact" ? "comfortable" : "compact" }),
      },
      { id: "design", group: "Display", label: "Design system reference", onRun: go("/_design") },
      { id: "signout", group: "Account", label: "Sign out", onRun: () => void signOut() },
    );
    return items;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me, prefs.density]);

  useHotkeys({
    "mod+k": () => setPaletteOpen(true),
    "?": () => setShortcutsOpen(true),
    "mod+.": () => setPrefs({ density: prefs.density === "compact" ? "comfortable" : "compact" }),
  });

  const name = me.company.tradeName || me.company.legalName;

  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-50 focus:bg-sheet focus:px-3 focus:py-1.5"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-30 flex h-14 items-center gap-4 border-b border-rule bg-paper/95 px-5 backdrop-blur-sm">
        <Link to="/" className="flex items-baseline gap-2.5 outline-none">
          <span className="font-serif text-[1.35rem] font-medium tracking-tight text-ink">
            Ledger<span className="text-accent">·</span>
          </span>
          <span className="hidden max-w-[22ch] truncate font-serif text-sm italic text-ink-2 sm:inline">
            {name}
          </span>
        </Link>
        <button
          type="button"
          onClick={() => setPaletteOpen(true)}
          className="mx-auto flex h-8 w-full max-w-md items-center justify-between rounded-sm border border-rule bg-sheet px-3 text-sm text-ink-3 transition-colors hover:border-rule-strong"
        >
          <span className="font-serif italic">Search or jump to…</span>
          <Kbd>Ctrl K</Kbd>
        </button>
        <SyncDot state={sync} />
        <UserMenu me={me} theme={prefs.theme} density={prefs.density} onSignOut={signOut} />
      </header>

      <div className="flex flex-1">
        <nav
          aria-label="Sections"
          className={cn(
            "shrink-0 border-r border-rule py-6 transition-[width] duration-200",
            collapsed ? "w-14" : "w-52",
          )}
        >
          <ul className="flex flex-col gap-0.5">
            {SECTIONS.filter((s) => !s.permission || can(me, s.permission)).map((section) => {
              const active = section.to
                ? section.to === "/"
                  ? path === "/"
                  : path.startsWith(section.to)
                : false;
              const content = (
                <>
                  <span className="smallcaps text-inherit" style={{ color: "inherit" }}>
                    {collapsed ? section.label.slice(0, 2) : section.label}
                  </span>
                  {!collapsed && section.stage ? (
                    <span className="font-serif text-xs italic text-ink-3">
                      stage {section.stage}
                    </span>
                  ) : null}
                </>
              );
              const base = "flex h-8 items-center justify-between gap-2 px-5";
              return (
                <li key={section.label}>
                  {section.to ? (
                    <Link
                      to={section.to}
                      title={collapsed ? section.label : undefined}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        base,
                        "text-ink-2 transition-colors hover:text-ink",
                        active && "text-ink shadow-[inset_2px_0_0_var(--accent)]",
                      )}
                    >
                      {content}
                    </Link>
                  ) : (
                    <span
                      className={cn(base, "cursor-default text-ink-3")}
                      title={`${section.label} arrives in Stage ${section.stage}`}
                    >
                      {content}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            className="smallcaps mt-8 px-5 text-ink-3 hover:text-ink"
            aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
          >
            {collapsed ? "»" : "« Collapse"}
          </button>
        </nav>

        <main id="main" className="min-w-0 flex-1 px-4 py-8 sm:px-8 xl:px-12">
          {children}
        </main>
      </div>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} items={commands} />
      <ShortcutOverlay open={shortcutsOpen} onOpenChange={setShortcutsOpen} shortcuts={SHORTCUTS} />
    </div>
  );
}

function SyncDot({ state }: { state: SyncState }) {
  const label = state === "live" ? "Live" : state === "connecting" ? "Connecting" : "Offline";
  return (
    <span
      className="hidden items-center gap-1.5 text-xs text-ink-3 md:inline-flex"
      title={`Live updates: ${label}`}
      data-sync={state}
    >
      <span
        className={cn(
          "size-1.5 rounded-full",
          state === "live" && "animate-pulse bg-positive [animation-duration:2.4s]",
          state === "connecting" && "bg-caution",
          state === "offline" && "bg-ink-3",
        )}
        aria-hidden
      />
      {label}
    </span>
  );
}

function UserMenu({
  me,
  theme,
  density,
  onSignOut,
}: {
  me: MeResponse;
  theme: Theme;
  density: Density;
  onSignOut: () => void;
}) {
  const initials = me.user.name
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <Popover
      align="end"
      trigger={
        <button
          type="button"
          aria-label="Account and display"
          className="flex size-8 items-center justify-center rounded-full border border-rule-strong font-serif text-sm text-ink hover:bg-wash"
        >
          {initials}
        </button>
      }
    >
      <div className="grid w-64 gap-4">
        <div>
          <p className="text-sm font-medium text-ink">{me.user.name}</p>
          <p className="text-xs text-ink-2">{me.user.email}</p>
          <p className="smallcaps mt-1.5">{me.roles.join(" · ")}</p>
        </div>
        <div className="grid gap-2">
          <p className="smallcaps">Theme</p>
          <Segmented<Theme>
            label="Theme"
            value={theme}
            onValueChange={(t) => setPrefs({ theme: t })}
            options={[
              { value: "system", label: "System" },
              { value: "light", label: "Light" },
              { value: "dark", label: "Dark" },
            ]}
          />
          <p className="smallcaps mt-1">Density</p>
          <Segmented<Density>
            label="Density"
            value={density}
            onValueChange={(d) => setPrefs({ density: d })}
            options={[
              { value: "comfortable", label: "Comfortable" },
              { value: "compact", label: "Compact" },
            ]}
          />
        </div>
        <Button variant="secondary" size="sm" onClick={onSignOut}>
          Sign out
        </Button>
      </div>
    </Popover>
  );
}
