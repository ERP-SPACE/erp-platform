import type { AuditItem } from "@erp/contracts";
import {
  Button,
  DefinitionList,
  EmptyState,
  Mono,
  Register,
  Select,
  Sheet,
  StatusMark,
} from "@erp/ui";
import { useInfiniteQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { useMemo, useState } from "react";
import { z } from "zod";
import { api, call } from "../../../lib/api.js";
import { dateTime } from "../../../lib/format.js";

export const Route = createFileRoute("/_app/settings/audit")({
  validateSearch: z.object({ table: z.string().optional(), rowId: z.string().optional() }),
  component: AuditPage,
});

const TABLES = [
  { value: "all", label: "Everything" },
  { value: "settings", label: "Settings" },
  { value: "companies", label: "Company profile" },
  { value: "document_series", label: "Document series" },
  { value: "user", label: "Users" },
  { value: "user_roles", label: "Role assignments" },
  { value: "role_permissions", label: "Permissions" },
];

const ACTION: Record<
  AuditItem["action"],
  { label: string; tone: "positive" | "info" | "critical" }
> = {
  INSERT: { label: "Created", tone: "positive" },
  UPDATE: { label: "Changed", tone: "info" },
  DELETE: { label: "Removed", tone: "critical" },
};

function AuditPage() {
  const { table, rowId } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const [selected, setSelected] = useState<AuditItem | null>(null);

  const audit = useInfiniteQuery({
    queryKey: ["audit", { table, rowId }],
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
  const current = selected ?? items[0] ?? null;

  const columns = useMemo<ColumnDef<AuditItem, unknown>[]>(
    () => [
      {
        accessorKey: "at",
        header: "When",
        cell: (c) => <span className="tnum text-ink-2">{dateTime(c.getValue() as string)}</span>,
        meta: { width: "11rem" },
      },
      {
        accessorKey: "userName",
        header: "Who",
        cell: (c) =>
          (c.getValue() as string | null) ?? <span className="italic text-ink-3">System</span>,
      },
      {
        id: "what",
        header: "What",
        accessorFn: (r) => `${r.tableName} ${r.rowId ?? ""}`,
        cell: ({ row }) => (
          <span>
            {TABLES.find((t) => t.value === row.original.tableName)?.label ??
              row.original.tableName}
            <Mono className="ml-1.5 text-ink-3">{row.original.rowId}</Mono>
          </span>
        ),
      },
      {
        accessorKey: "action",
        header: "Action",
        cell: (c) => {
          const a = ACTION[c.getValue() as AuditItem["action"]];
          return <StatusMark tone={a.tone}>{a.label}</StatusMark>;
        },
      },
    ],
    [],
  );

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-end gap-4">
        <div className="w-60">
          <Select
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
            Clear record filter ×
          </Button>
        ) : null}
      </div>

      <div className="grid gap-8 2xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="grid content-start gap-3">
          <Register
            caption="Audit log"
            data={items}
            columns={columns}
            getRowId={(r) => String(r.id)}
            selectedId={current ? String(current.id) : null}
            onSelect={setSelected}
            empty={<EmptyState title="No changes recorded yet." />}
          />
          {audit.hasNextPage ? (
            <Button
              variant="ghost"
              busy={audit.isFetchingNextPage}
              onClick={() => void audit.fetchNextPage()}
            >
              Older entries
            </Button>
          ) : null}
        </div>
        {current ? <AuditSheet item={current} /> : null}
      </div>
    </div>
  );
}

const show = (value: unknown) =>
  value === undefined ? "—" : typeof value === "string" ? value : JSON.stringify(value);

function AuditSheet({ item }: { item: AuditItem }) {
  const keys =
    item.action === "UPDATE" && item.changedKeys?.length
      ? item.changedKeys
      : Object.keys(item.after ?? item.before ?? {}).filter(
          (k) => !["created_at", "updated_at", "created_by", "updated_by"].includes(k),
        );
  const a = ACTION[item.action];
  return (
    <Sheet
      kicker="Audit entry"
      title={`${a.label} ${TABLES.find((t) => t.value === item.tableName)?.label.toLowerCase() ?? item.tableName}`}
      number={<span className="tnum">#{item.id}</span>}
      status={<StatusMark tone={a.tone}>{item.action}</StatusMark>}
    >
      <DefinitionList
        items={[
          { label: "When", value: <span className="tnum">{dateTime(item.at)}</span> },
          { label: "Who", value: item.userName ?? "System" },
          { label: "Record", value: <Mono>{item.rowId ?? "—"}</Mono> },
          {
            label: "Reason",
            value: item.reason ?? <span className="italic text-ink-3">None given</span>,
          },
        ]}
      />
      <table className="mt-6 w-full border-collapse text-sm" data-testid="audit-diff">
        <caption className="sr-only">Before and after</caption>
        <thead>
          <tr className="border-b border-rule-strong">
            <th scope="col" className="smallcaps h-9 w-1/4 text-left">
              Field
            </th>
            <th scope="col" className="smallcaps h-9 text-left">
              Before
            </th>
            <th scope="col" className="smallcaps h-9 text-left">
              After
            </th>
          </tr>
        </thead>
        <tbody>
          {keys.map((key) => (
            <tr key={key} className="border-b border-rule align-top">
              <th scope="row" className="py-2 pr-3 text-left font-normal text-ink-2">
                {key}
              </th>
              <td className="py-2 pr-3">
                <Mono className="break-all text-critical/90 line-through decoration-critical/40">
                  {item.before ? show(item.before[key]) : "—"}
                </Mono>
              </td>
              <td className="py-2">
                <Mono className="break-all text-ink">
                  {item.after ? show(item.after[key]) : "—"}
                </Mono>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {item.requestId ? (
        <p className="mt-4 text-xs text-ink-3">
          Request <Mono>{item.requestId}</Mono>
        </p>
      ) : null}
    </Sheet>
  );
}
