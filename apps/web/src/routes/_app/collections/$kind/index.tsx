import type { ReceiptListItem } from "@erp/contracts";
import { Badge, Button, DataTable, Mono, PageHeader, Segmented } from "@erp/ui";
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute, notFound, useNavigate } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus } from "lucide-react";
import { z } from "zod";
import {
  KIND,
  MODE_LABEL,
  MONEY_TONE,
  type MoneyKind,
  moneyListQuery,
} from "../../../../lib/collections.js";
import { can, meQuery } from "../../../../lib/queries.js";
import { rupees } from "../../../../lib/sales.js";

export const Route = createFileRoute("/_app/collections/$kind/")({
  params: {
    parse: (p) => {
      if (p.kind !== "receipts" && p.kind !== "payments") throw notFound();
      return { kind: p.kind as MoneyKind };
    },
    stringify: (p) => p,
  },
  validateSearch: z.object({ show: z.enum(["all", "onAccount"]).optional() }),
  component: MoneyListPage,
});

const columns = (party: string): ColumnDef<ReceiptListItem, unknown>[] => [
  {
    accessorKey: "docNo",
    header: "No.",
    cell: (c) =>
      c.getValue() ? (
        <Mono>{c.getValue() as string}</Mono>
      ) : (
        <span className="text-fg-3">Draft</span>
      ),
  },
  { accessorKey: "date", header: "Date" },
  {
    accessorKey: "partyName",
    header: party,
    cell: (c) => <span className="font-medium">{c.getValue() as string}</span>,
  },
  {
    accessorKey: "mode",
    header: "Mode",
    cell: (c) => (
      <span>
        {MODE_LABEL[c.row.original.mode]}
        {c.row.original.reference ? (
          <Mono className="ml-2 text-xs text-fg-3">{c.row.original.reference}</Mono>
        ) : null}
      </span>
    ),
  },
  {
    accessorKey: "amount",
    header: "Amount",
    meta: { numeric: true },
    cell: (c) => rupees(c.getValue() as string),
  },
  {
    accessorKey: "unallocated",
    header: "On account",
    meta: { numeric: true },
    cell: (c) =>
      Number(c.getValue()) > 0 ? (
        <Badge tone="warning">{rupees(c.getValue() as string)}</Badge>
      ) : (
        <span className="text-fg-3">—</span>
      ),
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: (c) => {
      const s = c.getValue() as ReceiptListItem["status"];
      return <Badge tone={MONEY_TONE[s]}>{s}</Badge>;
    },
  },
];

function MoneyListPage() {
  const { kind } = Route.useParams();
  const { show = "all" } = Route.useSearch();
  const k = KIND[kind];
  const { data: me } = useQuery(meQuery);
  const { data, isLoading } = useQuery(
    moneyListQuery(kind, show === "onAccount" ? { onAccount: "true" } : {}),
  );
  const navigate = useNavigate({ from: Route.fullPath });
  return (
    <div className="grid gap-6">
      <PageHeader
        title={k.title}
        description={
          kind === "receipts"
            ? "Money received from customers, allocated to their invoices. Anything unallocated stays on account."
            : "Money paid to suppliers against their purchase invoices. Large payments need the Owner's approval."
        }
        breadcrumbs={[{ label: "Collections" }, { label: k.title }]}
        actions={
          can(me, k.manage) ? (
            <Button asChild variant="primary" icon={Plus}>
              <Link to="/collections/$kind/new" params={{ kind }}>
                {k.newLabel}
              </Link>
            </Button>
          ) : null
        }
      />
      <DataTable
        caption={k.title}
        data={data ?? []}
        loading={isLoading}
        columns={columns(kind === "receipts" ? "Customer" : "Supplier")}
        getRowId={(r) => r.id}
        onRowClick={(r) =>
          void navigate({ to: "/collections/$kind/$moneyId", params: { kind, moneyId: r.id } })
        }
        searchPlaceholder={`Search number, ${kind === "receipts" ? "customer" : "supplier"} or reference`}
        toolbar={
          <Segmented
            label="Show"
            value={show}
            onValueChange={(v) => void navigate({ search: { show: v } })}
            options={[
              { value: "all", label: "All" },
              { value: "onAccount", label: "With money on account" },
            ]}
          />
        }
      />
    </div>
  );
}
