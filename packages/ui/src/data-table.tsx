import {
  type ColumnDef,
  type RowSelectionState,
  type SortingState,
  type VisibilityState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Columns3 } from "lucide-react";
import { type KeyboardEvent, type ReactNode, useMemo, useRef, useState } from "react";
import { Button } from "./button.js";
import { cn } from "./cn.js";
import { Checkbox, SearchInput } from "./fields.js";
import { Popover } from "./overlay.js";
import { EmptyState, Skeleton } from "./typography.js";

declare module "@tanstack/react-table" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData, TValue> {
    align?: "left" | "right" | "center";
    /** Numeric columns: right-aligned tabular figures. */
    numeric?: boolean;
    width?: string;
    /** Label used in the column-visibility menu when the header isn't a string. */
    label?: string;
  }
}

export interface DataTableProps<T> {
  data: T[];
  columns: ColumnDef<T, unknown>[];
  getRowId: (row: T) => string;
  caption: string;
  selectedId?: string | null;
  onRowClick?: (row: T) => void;
  /** Enter on the focused row (defaults to onRowClick). */
  onOpen?: (row: T) => void;
  loading?: boolean;
  empty?: ReactNode;
  /** Built-in client-side search across all columns. Omit to hide the search box. */
  searchPlaceholder?: string;
  /** Controlled search text (e.g. kept in the URL); otherwise internal. */
  search?: string;
  onSearchChange?: (value: string) => void;
  /** Extra toolbar content: filter selects, chips, buttons. */
  toolbar?: ReactNode;
  /** Rows per page; `false` shows everything (use `height` to virtualise long lists). */
  pageSize?: number | false;
  height?: number;
  selectable?: boolean;
  onSelectionChange?: (ids: string[]) => void;
}

/**
 * The standard list view: toolbar, sortable sticky header, keyboard navigation (↑/↓/Enter),
 * pagination or virtualisation, optional row selection, loading skeleton and empty state.
 */
export function DataTable<T>({
  data,
  columns,
  getRowId,
  caption,
  selectedId,
  onRowClick,
  onOpen,
  loading,
  empty,
  searchPlaceholder,
  search,
  onSearchChange,
  toolbar,
  pageSize = 25,
  height,
  selectable,
  onSelectionChange,
}: DataTableProps<T>) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [visibility, setVisibility] = useState<VisibilityState>({});
  const [selection, setSelection] = useState<RowSelectionState>({});
  const [internalSearch, setInternalSearch] = useState("");
  const [focusIndex, setFocusIndex] = useState(0);
  const globalFilter = search ?? internalSearch;

  const allColumns = useMemo<ColumnDef<T, unknown>[]>(
    () =>
      selectable
        ? [
            {
              id: "__select",
              enableSorting: false,
              enableHiding: false,
              meta: { width: "2.5rem" },
              header: ({ table }) => (
                <Checkbox
                  aria-label="Select all rows"
                  checked={table.getIsAllPageRowsSelected()}
                  onCheckedChange={(v) => table.toggleAllPageRowsSelected(v)}
                />
              ),
              cell: ({ row }) => (
                <span onClick={(e) => e.stopPropagation()}>
                  <Checkbox
                    aria-label="Select row"
                    checked={row.getIsSelected()}
                    onCheckedChange={(v) => row.toggleSelected(v)}
                  />
                </span>
              ),
            },
            ...columns,
          ]
        : columns,
    [columns, selectable],
  );

  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data,
    columns: allColumns,
    state: { sorting, columnVisibility: visibility, rowSelection: selection, globalFilter },
    onSortingChange: setSorting,
    onColumnVisibilityChange: setVisibility,
    onRowSelectionChange: (updater) => {
      const next = typeof updater === "function" ? updater(selection) : updater;
      setSelection(next);
      onSelectionChange?.(Object.keys(next).filter((id) => next[id]));
    },
    onGlobalFilterChange: (value: string) => (onSearchChange ?? setInternalSearch)(value),
    getRowId,
    enableRowSelection: Boolean(selectable),
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    ...(pageSize ? { getPaginationRowModel: getPaginationRowModel() } : {}),
    initialState: pageSize ? { pagination: { pageSize, pageIndex: 0 } } : undefined,
  });
  const rows = table.getRowModel().rows;
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 44,
    overscan: 12,
    enabled: Boolean(height) && !pageSize,
  });

  const onKeyDown = (event: KeyboardEvent<HTMLTableSectionElement>) => {
    if (!rows.length) return;
    const move = (to: number) => {
      const next = Math.max(0, Math.min(rows.length - 1, to));
      setFocusIndex(next);
      if (height && !pageSize) virtualizer.scrollToIndex(next);
      (
        scrollRef.current?.querySelector(`[data-row-index="${next}"]`) as HTMLElement | null
      )?.focus();
      event.preventDefault();
    };
    if (event.key === "ArrowDown" || event.key === "j") move(focusIndex + 1);
    else if (event.key === "ArrowUp" || event.key === "k") move(focusIndex - 1);
    else if (event.key === "Home") move(0);
    else if (event.key === "End") move(rows.length - 1);
    else if (event.key === "Enter") {
      const row = rows[focusIndex]?.original;
      if (row) (onOpen ?? onRowClick)?.(row);
    }
  };

  const virtual = Boolean(height) && !pageSize;
  const visible = virtual
    ? virtualizer.getVirtualItems()
    : rows.map((_, index) => ({ index, start: 0, size: 0, key: index }));
  const padTop = virtual && visible.length ? visible[0]!.start : 0;
  const padBottom =
    virtual && visible.length
      ? virtualizer.getTotalSize() -
        visible[visible.length - 1]!.start -
        visible[visible.length - 1]!.size
      : 0;
  const hideable = table.getAllLeafColumns().filter((c) => c.getCanHide());
  const showToolbar = searchPlaceholder !== undefined || toolbar || hideable.length > 0;
  const filteredCount = table.getFilteredRowModel().rows.length;

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface shadow-card">
      {showToolbar ? (
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
          {searchPlaceholder !== undefined ? (
            <SearchInput
              aria-label={searchPlaceholder || "Search"}
              placeholder={searchPlaceholder}
              value={globalFilter}
              onChange={(e) => table.setGlobalFilter(e.target.value)}
              className="w-full max-w-xs"
            />
          ) : null}
          {toolbar}
          <div className="ml-auto flex items-center gap-2">
            {hideable.length > 0 ? (
              <Popover
                align="end"
                trigger={
                  <Button variant="secondary" size="sm" icon={Columns3}>
                    Columns
                  </Button>
                }
              >
                <div className="flex min-w-40 flex-col gap-2">
                  {hideable.map((column) => (
                    <Checkbox
                      key={column.id}
                      label={
                        column.columnDef.meta?.label ?? String(column.columnDef.header ?? column.id)
                      }
                      checked={column.getIsVisible()}
                      onCheckedChange={(v) => column.toggleVisibility(v)}
                    />
                  ))}
                </div>
              </Popover>
            ) : null}
          </div>
        </div>
      ) : null}

      <div ref={scrollRef} className="overflow-auto" style={virtual ? { height } : undefined}>
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead className="sticky top-0 z-10 bg-muted">
            {table.getHeaderGroups().map((group) => (
              <tr key={group.id} className="border-b border-border">
                {group.headers.map((header) => {
                  const meta = header.column.columnDef.meta;
                  const sorted = header.column.getIsSorted();
                  const right = meta?.numeric || meta?.align === "right";
                  return (
                    <th
                      key={header.id}
                      scope="col"
                      style={meta?.width ? { width: meta.width } : undefined}
                      className={cn(
                        "h-10 whitespace-nowrap px-[var(--pad-x)] text-xs font-medium text-fg-3",
                        right ? "text-right" : "text-left",
                      )}
                      aria-sort={
                        sorted === "asc"
                          ? "ascending"
                          : sorted === "desc"
                            ? "descending"
                            : undefined
                      }
                    >
                      {header.isPlaceholder ? null : header.column.getCanSort() ? (
                        <button
                          type="button"
                          className={cn(
                            "inline-flex items-center gap-1 hover:text-fg",
                            right && "flex-row-reverse",
                          )}
                          onClick={header.column.getToggleSortingHandler()}
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {sorted === "asc" ? (
                            <ArrowUp className="size-3" aria-hidden />
                          ) : sorted === "desc" ? (
                            <ArrowDown className="size-3" aria-hidden />
                          ) : (
                            <ArrowUpDown className="size-3 opacity-40" aria-hidden />
                          )}
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
            {loading
              ? Array.from({ length: 6 }, (_, i) => (
                  <tr key={`sk-${i}`} className="h-[var(--row-h)] border-b border-border">
                    {table.getVisibleLeafColumns().map((c) => (
                      <td key={c.id} className="px-[var(--pad-x)]">
                        <Skeleton className="h-3.5 w-3/4" />
                      </td>
                    ))}
                  </tr>
                ))
              : null}
            {!loading && rows.length === 0 ? (
              <tr>
                <td colSpan={table.getVisibleLeafColumns().length}>
                  {globalFilter ? (
                    <EmptyState title="No matches" hint={`Nothing matches “${globalFilter}”.`} />
                  ) : (
                    (empty ?? <EmptyState title="Nothing here yet" />)
                  )}
                </td>
              </tr>
            ) : null}
            {padTop > 0 ? <tr style={{ height: padTop }} aria-hidden /> : null}
            {!loading &&
              visible.map(({ index }) => {
                const row = rows[index]!;
                const selected = selectedId != null && row.id === selectedId;
                return (
                  <tr
                    key={row.id}
                    data-row-index={index}
                    tabIndex={index === focusIndex ? 0 : -1}
                    aria-selected={selected || row.getIsSelected() || undefined}
                    onClick={() => {
                      setFocusIndex(index);
                      onRowClick?.(row.original);
                    }}
                    onFocus={() => setFocusIndex(index)}
                    className={cn(
                      "h-[var(--row-h)] border-b border-border outline-none transition-colors last:border-b-0",
                      onRowClick && "cursor-pointer hover:bg-muted/60 focus-visible:bg-muted",
                      (selected || row.getIsSelected()) &&
                        "bg-primary-soft/60 hover:bg-primary-soft/60",
                    )}
                  >
                    {row.getVisibleCells().map((cell) => {
                      const meta = cell.column.columnDef.meta;
                      return (
                        <td
                          key={cell.id}
                          className={cn(
                            "px-[var(--pad-x)] align-middle text-fg",
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

      {pageSize && filteredCount > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-2.5 text-sm text-fg-3">
          <span className="tnum">
            {table.getState().pagination.pageIndex * table.getState().pagination.pageSize + 1}–
            {Math.min(
              filteredCount,
              (table.getState().pagination.pageIndex + 1) * table.getState().pagination.pageSize,
            )}{" "}
            of {filteredCount}
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant="secondary"
              size="sm"
              iconOnly
              icon={ChevronLeft}
              aria-label="Previous page"
              disabled={!table.getCanPreviousPage()}
              onClick={() => table.previousPage()}
            />
            <span className="tnum px-2">
              Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount()}
            </span>
            <Button
              variant="secondary"
              size="sm"
              iconOnly
              icon={ChevronRight}
              aria-label="Next page"
              disabled={!table.getCanNextPage()}
              onClick={() => table.nextPage()}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
