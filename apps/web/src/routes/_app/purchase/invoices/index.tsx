import type { PiListItem } from "@erp/contracts";
import { formatINR } from "@erp/domain";
import { Badge, Button, DataTable, Mono, PageHeader } from "@erp/ui";
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus } from "lucide-react";
import { DOC_TONE, piListQuery } from "../../../../lib/purchase.js";
import { can, meQuery } from "../../../../lib/queries.js";

export const Route = createFileRoute("/_app/purchase/invoices/")({ component: PiListPage });

const columns: ColumnDef<PiListItem, unknown>[] = [
  {
    accessorKey: "supplierInvoiceNo",
    header: "Supplier's no.",
    cell: (c) => <span className="font-medium">{c.getValue() as string}</span>,
  },
  { accessorKey: "supplierInvoiceDate", header: "Date" },
  { accessorKey: "supplierName", header: "Supplier" },
  {
    accessorKey: "piNo",
    header: "Our ref",
    cell: (c) => (c.getValue() ? <Mono>{c.getValue() as string}</Mono> : "—"),
  },
  { accessorKey: "rollCount", header: "Rolls", meta: { numeric: true } },
  {
    accessorKey: "total",
    header: "Total",
    meta: { numeric: true },
    cell: (c) => formatINR(c.getValue() as string),
  },
  {
    accessorKey: "landedCostAllocated",
    header: "Landed cost",
    cell: (c) =>
      c.row.original.status !== "Posted" ? (
        "—"
      ) : c.getValue() ? (
        <Badge tone="success">Allocated</Badge>
      ) : (
        <Badge tone="warning">Pending</Badge>
      ),
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: (c) => (
      <Badge tone={DOC_TONE[c.getValue() as PiListItem["status"]]}>{c.getValue() as string}</Badge>
    ),
  },
];

function PiListPage() {
  const { data: me } = useQuery(meQuery);
  const { data, isLoading } = useQuery(piListQuery);
  const navigate = useNavigate();
  return (
    <div className="grid gap-6">
      <PageHeader
        title="Purchase invoices"
        description="Suppliers' tax invoices. Posting fixes each roll's cost; landed cost (freight, duty…) is added on top."
        breadcrumbs={[{ label: "Purchase" }, { label: "Purchase invoices" }]}
        actions={
          can(me, "purchase.invoice.manage") ? (
            <Button asChild variant="primary" icon={Plus}>
              <Link to="/purchase/invoices/new">Enter invoice</Link>
            </Button>
          ) : null
        }
      />
      <DataTable
        caption="Purchase invoices"
        data={data ?? []}
        loading={isLoading}
        columns={columns}
        getRowId={(r) => r.id}
        onRowClick={(r) =>
          void navigate({ to: "/purchase/invoices/$piId", params: { piId: r.id } })
        }
        searchPlaceholder="Search invoice no. or supplier"
      />
    </div>
  );
}
