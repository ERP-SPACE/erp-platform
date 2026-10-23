import {
  type ColumnDef,
  type SortingState,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { type KeyboardEvent, type ReactNode, useRef, useState } from "react";
import { cn } from "./cn.js";
import { EmptyState } from "./typography.js";

declare module "@tanstack/react-table" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData, TValue> {
    align?: "left" | "right" | "center";
    /** Numeric columns: right-aligned tabular figures. */
    numeric?: boolean;
    width?: string;
  }
}

export interface RegisterProps<T> {
  data: T[];
  columns: ColumnDef<T, unknown>[];
  getRowId: (row: T) => string;
  selectedId?: string | null;
  onSelect?: (row: T) => void;
  /** Enter on the focused row (defaults to onSelect). */
  onOpen?: (row: T) => void;
  empty?: ReactNode;
  /** Fixed height enables row virtualisation for long registers. */
  height?: number;
  caption: string;
}

/**
 * The ruled register (brief B3): ledger-style rows, small-caps header, tabular numerals,
 * ↑/↓ to move, Enter to open. Virtualised when a height is given.
 */
export function Register<T>({ data, columns, getRowId, selectedId, onSelect, onOpen, empty, height, caption }: RegisterProps<T>) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [focusIndex, setFocusIndex] = useState(0);
  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getRowId,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });
  const rows = table.getRowModel().rows;
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 40,
    overscan: 12,
    enabled: Boolean(height),
  });

  const onKeyDown = (event: KeyboardEvent<HTMLTableSectionElement>) => {
    if (!rows.length) return;
    const move = (to: number) => {
      const next = Math.max(0, Math.min(rows.length - 1, to));
      setFocusIndex(next);
      if (height) virtualizer.scrollToIndex(next);
      (scrollRef.current?.querySelector(`[data-row-index="${next}"]`) as HTMLElement | null)?.focus();
      event.preventDefault();
    };
    if (event.key === "ArrowDown" || event.key === "j") move(focusIndex + 1);
    else if (event.key === "ArrowUp" || event.key === "k") move(focusIndex - 1);
    else if (event.key === "Home") move(0);
    else if (event.key === "End") move(rows.length - 1);
    else if (event.key === "Enter") {
      const row = rows[focusIndex]?.original;
      if (row) (onOpen ?? onSelect)?.(row);
    }
  };

  if (!data.length) return <>{empty ?? <EmptyState title="Nothing here yet." />}</>;

  const visible = height ? virtualizer.getVirtualItems() : rows.map((_, index) => ({ index, start: 0, size: 0, key: index }));
  const padTop = height && visible.length ? visible[0]!.start : 0;
  const padBottom = height && visible.length ? virtualizer.getTotalSize() - visible[visible.length - 1]!.start - visible[visible.length - 1]!.size : 0;

  return (
    <div ref={scrollRef} className="overflow-auto" style={height ? { height } : undefined}>
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="sticky top-0 z-10 bg-paper">
          {table.getHeaderGroups().map((group) => (
            <tr key={group.id} className="border-b border-rule-strong">
              {group.headers.map((header) => {
                const meta = header.column.columnDef.meta;
                const sorted = header.column.getIsSorted();
                return (
                  <th
                    key={header.id}
                    scope="col"
                    style={meta?.width ? { width: meta.width } : undefined}
                    className={cn("smallcaps h-9 px-[var(--pad-x)] font-semibold", meta?.numeric || meta?.align === "right" ? "text-right" : "text-left")}
                    aria-sort={sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : undefined}
                  >
                    {header.isPlaceholder ? null : header.column.getCanSort() ? (
                      <button type="button" className="inline-flex items-center gap-1 uppercase hover:text-ink" onClick={header.column.getToggleSortingHandler()}>
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        <span className="text-ink-3" aria-hidden>
                          {sorted === "asc" ? "↑" : sorted === "desc" ? "↓" : ""}
                        </span>
                      </button>
                    ) : (
                      flexRender(header.column.columnDef.header, header.getContext())
                    )}
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody onKeyDown={onKeyDown}>
          {padTop > 0 ? <tr style={{ height: padTop }} aria-hidden /> : null}
          {visible.map(({ index }) => {
            const row = rows[index]!;
            const selected = selectedId != null && row.id === selectedId;
            return (
              <tr
                key={row.id}
                data-row-index={index}
                tabIndex={index === focusIndex ? 0 : -1}
                aria-selected={selected || undefined}
                onClick={() => {
                  setFocusIndex(index);
                  onSelect?.(row.original);
                }}
                onFocus={() => setFocusIndex(index)}
                className={cn(
                  "h-[var(--row-h)] border-b border-rule outline-none transition-colors",
                  onSelect && "cursor-pointer hover:bg-wash/70 focus-visible:bg-wash",
                  selected && "bg-accent-wash/60 shadow-[inset_2px_0_0_var(--accent)] hover:bg-accent-wash/60",
                )}
              >
                {row.getVisibleCells().map((cell) => {
                  const meta = cell.column.columnDef.meta;
                  return (
                    <td
                      key={cell.id}
                      className={cn(
                        "px-[var(--pad-x)] align-middle text-ink",
                        (meta?.numeric || meta?.align === "right") && "tnum text-right",
                        meta?.align === "center" && "text-center",
                      )}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  );
                })}
              </tr>
            );
          })}
          {padBottom > 0 ? <tr style={{ height: padBottom }} aria-hidden /> : null}
        </tbody>
      </table>
    </div>
  );
}
