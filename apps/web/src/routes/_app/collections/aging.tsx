import type { AgingReport } from "@erp/contracts";
import { formatINRCompact } from "@erp/domain";
import { Badge, DataTable, PageHeader, Segmented, StatCard } from "@erp/ui";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { z } from "zod";
import { agingQuery } from "../../../lib/collections.js";
import { can, meQuery } from "../../../lib/queries.js";
import { count, rupees } from "../../../lib/sales.js";

export const Route = createFileRoute("/_app/collections/aging")({
  validateSearch: z.object({ party: z.enum(["CUSTOMER", "SUPPLIER"]).optional() }),
  component: AgingPage,
});

type Row = AgingReport["rows"][number];

/** AR / AP aging (PRD §9): what each party owes by age since the invoice date. */
function AgingPage() {
  const { party = "CUSTOMER" } = Route.useSearch();
  const { data: me } = useQuery(meQuery);
  const { data, isLoading } = useQuery(agingQuery(party));
  const navigate = useNavigate({ from: Route.fullPath });
  const buckets = data?.buckets ?? [];
  const columns: ColumnDef<Row, unknown>[] = [
    {
      accessorKey: "partyName",
      header: party === "CUSTOMER" ? "Customer" : "Supplier",
      cell: (c) => <span className="font-medium">{c.getValue() as string}</span>,
    },
    ...buckets.map((label, i): ColumnDef<Row, unknown> => ({
      id: `b${i}`,
      header: label,
      meta: { numeric: true },
      accessorFn: (r) => Number(r.buckets[i]),
      cell: (c) => {
        const v = c.row.original.buckets[i]!;
        if (!Number(v)) return <span className="text-fg-3">—</span>;
        return (
          <span
            className={
              i === buckets.length - 1
                ? "font-medium text-danger"
                : i > 0
                  ? "text-warning"
                  : undefined
            }
          >
            {rupees(v)}
          </span>
        );
      },
    })),
    {
      accessorKey: "total",
      header: "Total",
      meta: { numeric: true },
      cell: (c) => <span className="font-semibold">{rupees(c.getValue() as string)}</span>,
    },
    {
      accessorKey: "onAccount",
      header: "On account",
      meta: { numeric: true },
      cell: (c) =>
        Number(c.getValue()) ? (
          <Badge tone="info">{rupees(c.getValue() as string)}</Badge>
        ) : (
          <span className="text-fg-3">—</span>
        ),
    },
    {
      accessorKey: "oldestDays",
      header: "Oldest",
      meta: { numeric: true },
      cell: (c) => `${c.getValue() as number} days`,
    },
  ];
  return (
    <div className="grid gap-6">
      <PageHeader
        title={party === "CUSTOMER" ? "Receivables aging" : "Payables aging"}
        description={`What is ${party === "CUSTOMER" ? "owed to us" : "owed to suppliers"}, by days since the invoice date${data ? ` · as of ${data.asOf}` : ""}.`}
        breadcrumbs={[{ label: "Collections" }, { label: "Aging" }]}
      />
      {data ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <StatCard
            label="Total outstanding"
            value={formatINRCompact(data.total)}
            hint={count(data.rows.length, party === "CUSTOMER" ? "customer" : "supplier")}
          />
          {data.buckets.map((b, i) => (
            <StatCard key={b} label={b} value={formatINRCompact(data.totals[i]!)} />
          ))}
        </div>
      ) : null}
      <DataTable
        caption={party === "CUSTOMER" ? "Receivables aging" : "Payables aging"}
        data={data?.rows ?? []}
        loading={isLoading}
        columns={columns}
        getRowId={(r) => r.partyId}
        empty="Nothing outstanding."
        searchPlaceholder="Search name"
        onRowClick={(r) =>
          void navigate({
            to: "/collections/statement/$party/$partyId",
            params: { party, partyId: r.partyId },
          })
        }
        toolbar={
          can(me, "payables.view") ? (
            <Segmented
              label="Show"
              value={party}
              onValueChange={(v) => void navigate({ search: { party: v } })}
              options={[
                { value: "CUSTOMER", label: "Receivables" },
                { value: "SUPPLIER", label: "Payables" },
              ]}
            />
          ) : undefined
        }
      />
    </div>
  );
}
