import type { AuditItem } from "@erp/contracts";
import {
  Avatar,
  Badge,
  Button,
  DataTable,
  DefinitionList,
  Drawer,
  EmptyState,
  Mono,
  Select,
} from "@erp/ui";
import { useInfiniteQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { History } from "lucide-react";
import { useMemo, useState } from "react";
import { z } from "zod";
import { api, call } from "../../../lib/api.js";
import { dateTime } from "../../../lib/format.js";

export const Route = createFileRoute("/_app/settings/audit")({
  validateSearch: z.object({ table: z.string().optional(), rowId: z.string().optional() }),
  component: AuditPage,
});

const TABLES = [
  { value: "all", label: "All records" },
  { value: "settings", label: "Settings" },
  { value: "companies", label: "Company profile" },
  { value: "document_series", label: "Document series" },
  { value: "user", label: "Users" },
  { value: "user_roles", label: "Role assignments" },
  { value: "role_permissions", label: "Permissions" },
];

const ACTION: Record<AuditItem["action"], { label: string; tone: "success" | "info" | "danger" }> =
  {
    INSERT: { label: "Created", tone: "success" },
    UPDATE: { label: "Updated", tone: "info" },
    DELETE: { label: "Deleted", tone: "danger" },
  };

const tableLabel = (name: string) => TABLES.find((t) => t.value === name)?.label ?? name;

function AuditPage() {
  const { table, rowId } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const [selected, setSelected] = useState<AuditItem | null>(null);

  const audit = useInfiniteQuery({
    // Distinct from keys.audit(): this cache entry holds paged (infinite) data, not a single page.
    queryKey: ["audit-log", { table, rowId }],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      call(() =>
        api.GET("/api/audit", {
          params: { query: { table, rowId, cursor: pageParam, limit: 50 } },
        }),
      ),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const items = useMemo(() => audit.data?.pages.flatMap((p) => p.items) ?? [], [audit.data]);

  const columns = useMemo<ColumnDef<AuditItem, unknown>[]>(
    () => [
      {
        accessorKey: "at",
        header: "When",
        cell: (c) => <span className="tnum text-fg-2">{dateTime(c.getValue() as string)}</span>,
        meta: { width: "12rem" },
      },
      {
        id: "who",
        header: "User",
        accessorFn: (r) => r.userName ?? "System",
        cell: (c) => (
          <span className="flex items-center gap-2.5">
            <Avatar name={c.getValue() as string} size="sm" />
            {c.getValue() as string}
          </span>
        ),
      },
      {
        id: "what",
        header: "Record",
        accessorFn: (r) => `${tableLabel(r.tableName)} ${r.rowId ?? ""}`,
        cell: ({ row }) => (
          <span>
            {tableLabel(row.original.tableName)}
            <Mono className="ml-1.5 text-fg-3">{row.original.rowId}</Mono>
          </span>
        ),
      },
      {
        accessorKey: "action",
        header: "Action",
        cell: (c) => {
          const a = ACTION[c.getValue() as AuditItem["action"]];
          return <Badge tone={a.tone}>{a.label}</Badge>;
        },
      },
      {
        accessorKey: "reason",
        header: "Reason",
        cell: (c) => <span className="text-fg-2">{(c.getValue() as string | null) ?? "—"}</span>,
      },
    ],
    [],
  );

  return (
    <div className="grid gap-4">
      <DataTable
        caption="Audit log"
        data={items}
        loading={audit.isLoading}
        columns={columns}
        getRowId={(r) => String(r.id)}
        selectedId={selected ? String(selected.id) : null}
        onRowClick={setSelected}
        pageSize={false}
        toolbar={
          <>
            <div className="w-52">
              <Select
                aria-label="Filter by record type"
                value={table ?? "all"}
                onValueChange={(v) => {
                  setSelected(null);
                  void navigate({ search: v === "all" ? {} : { table: v } });
                }}
                options={TABLES}
              />
            </div>
            {rowId ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void navigate({ search: table ? { table } : {} })}
              >
                Clear record filter
              </Button>
            ) : null}
          </>
        }
        empty={<EmptyState icon={History} title="No changes recorded yet" />}
      />
      {audit.hasNextPage ? (
        <div className="flex justify-center">
          <Button
            variant="secondary"
            busy={audit.isFetchingNextPage}
            onClick={() => void audit.fetchNextPage()}
          >
            Load older entries
          </Button>
        </div>
      ) : null}
      {selected ? <AuditDrawer item={selected} onClose={() => setSelected(null)} /> : null}
    </div>
  );
}

const show = (value: unknown) =>
  value === undefined ? "—" : typeof value === "string" ? value : JSON.stringify(value);

function AuditDrawer({ item, onClose }: { item: AuditItem; onClose: () => void }) {
  const keys =
    item.action === "UPDATE" && item.changedKeys?.length
      ? item.changedKeys
      : Object.keys(item.after ?? item.before ?? {}).filter(
          (k) => !["created_at", "updated_at", "created_by", "updated_by"].includes(k),
        );
  const a = ACTION[item.action];
  return (
    <Drawer
      open
      onOpenChange={(open) => !open && onClose()}
      width="lg"
      title={`${a.label} ${tableLabel(item.tableName).toLowerCase()}`}
      description={`Entry #${item.id}`}
    >
      <div className="grid gap-6">
        <DefinitionList
          items={[
            { label: "When", value: <span className="tnum">{dateTime(item.at)}</span> },
            { label: "User", value: item.userName ?? "System" },
            { label: "Record", value: <Mono>{item.rowId ?? "—"}</Mono> },
            { label: "Action", value: <Badge tone={a.tone}>{a.label}</Badge> },
            {
              label: "Reason",
              value: item.reason ?? <span className="text-fg-3">None given</span>,
            },
          ]}
        />
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full border-collapse text-sm" data-testid="audit-diff">
            <caption className="sr-only">Before and after</caption>
            <thead className="bg-muted">
              <tr className="border-b border-border">
                <th scope="col" className="h-9 w-1/4 px-4 text-left text-xs font-medium text-fg-3">
                  Field
                </th>
                <th scope="col" className="h-9 px-4 text-left text-xs font-medium text-fg-3">
                  Before
                </th>
                <th scope="col" className="h-9 px-4 text-left text-xs font-medium text-fg-3">
                  After
                </th>
              </tr>
            </thead>
            <tbody>
              {keys.map((key) => (
                <tr key={key} className="border-b border-border align-top last:border-b-0">
                  <th scope="row" className="px-4 py-2.5 text-left font-medium text-fg-2">
                    {key}
                  </th>
                  <td className="bg-danger-soft/50 px-4 py-2.5">
                    <Mono className="break-all text-danger">
                      {item.before ? show(item.before[key]) : "—"}
                    </Mono>
                  </td>
                  <td className="bg-success-soft/50 px-4 py-2.5">
                    <Mono className="break-all text-success">
                      {item.after ? show(item.after[key]) : "—"}
                    </Mono>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {item.requestId ? (
          <p className="text-xs text-fg-3">
            Request ID <Mono>{item.requestId}</Mono>
          </p>
        ) : null}
      </div>
    </Drawer>
  );
}
