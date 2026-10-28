import type { SoListItem } from "@erp/contracts";
import { Badge, Button, DataTable, Mono, PageHeader, Segmented } from "@erp/ui";
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus } from "lucide-react";
import { z } from "zod";
import { can, meQuery } from "../../../../lib/queries.js";
import {
  CREDIT_REASON_LABEL,
  SO_TONE,
  STATUS_LABEL,
  soListQuery,
  rupees,
} from "../../../../lib/sales.js";

const FILTERS = ["open", "Draft", "OnHold", "Closed", "all"] as const;
export const Route = createFileRoute("/_app/sales/orders/")({
  validateSearch: z.object({ show: z.enum(FILTERS).optional() }),
  component: SoListPage,
});

const columns: ColumnDef<SoListItem, unknown>[] = [
  { accessorKey: "soNo", header: "Order", cell: (c) => <Mono>{c.getValue() as string}</Mono> },
  { accessorKey: "date", header: "Date" },
  {
    accessorKey: "customerName",
    header: "Customer",
    cell: (c) => <span className="font-medium">{c.getValue() as string}</span>,
  },
  { accessorKey: "salesmanName", header: "Salesman", cell: (c) => (c.getValue() as string) ?? "—" },
  {
    id: "progress",
    header: "Dispatched",
    meta: { numeric: true },
    accessorFn: (r) => r.dispatchedM,
    cell: (c) =>
      `${c.row.original.dispatchedM.toLocaleString("en-IN")} / ${c.row.original.orderedM.toLocaleString("en-IN")} m`,
  },
  {
    accessorKey: "total",
    header: "Value",
    meta: { numeric: true },
    cell: (c) => rupees(c.getValue() as string),
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: (c) => {
      const r = c.row.original;
      return (
        <span className="flex flex-wrap gap-1.5">
          <Badge tone={SO_TONE[r.status]}>{STATUS_LABEL[r.status] ?? r.status}</Badge>
          {r.pendingApproval ? <Badge tone="warning">Rate approval</Badge> : null}
          {r.heldReasons.map((h) => (
            <Badge key={h} tone="danger">
              {CREDIT_REASON_LABEL[h]}
            </Badge>
          ))}
        </span>
      );
    },
  },
];

function SoListPage() {
  const { show = "open" } = Route.useSearch();
  const { data: me } = useQuery(meQuery);
  const { data, isLoading } = useQuery(soListQuery());
  const navigate = useNavigate({ from: Route.fullPath });
  const rows = (data ?? []).filter((r) =>
    show === "all"
      ? true
      : show === "open"
        ? ["Confirmed", "PartiallyFulfilled", "OnHold", "Draft"].includes(r.status)
        : r.status === show,
  );
  return (
    <div className="grid gap-6">
      <PageHeader
        title="Sales orders"
        description="Orders from customers. Confirming runs the credit check; challans are picked against them."
        breadcrumbs={[{ label: "Sales" }, { label: "Orders" }]}
        actions={
          can(me, "sales.order.manage") ? (
            <Button asChild variant="primary" icon={Plus}>
              <Link to="/sales/orders/new">New order</Link>
            </Button>
          ) : null
        }
      />
      <DataTable
        caption="Sales orders"
        data={rows}
        loading={isLoading}
        columns={columns}
        getRowId={(r) => r.id}
        onRowClick={(r) => void navigate({ to: "/sales/orders/$soId", params: { soId: r.id } })}
        searchPlaceholder="Search order number or customer"
        toolbar={
          <Segmented
            label="Show"
            value={show}
            onValueChange={(v) => void navigate({ search: { show: v } })}
            options={[
              { value: "open", label: "Open" },
              { value: "Draft", label: "Drafts" },
              { value: "OnHold", label: "On hold" },
              { value: "Closed", label: "Closed" },
              { value: "all", label: "All" },
            ]}
          />
        }
      />
    </div>
  );
}
