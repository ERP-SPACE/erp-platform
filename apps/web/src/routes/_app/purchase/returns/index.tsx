import type { PurchaseReturnItem } from "@erp/contracts";
import { formatINR } from "@erp/domain";
import { Badge, Button, DataTable, Mono, PageHeader } from "@erp/ui";
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus } from "lucide-react";
import { DOC_TONE, returnListQuery } from "../../../../lib/purchase.js";
import { can, meQuery } from "../../../../lib/queries.js";

export const Route = createFileRoute("/_app/purchase/returns/")({ component: ReturnsPage });

const columns: ColumnDef<PurchaseReturnItem, unknown>[] = [
  {
    accessorKey: "prNo",
    header: "Return",
    cell: (c) =>
      c.getValue() ? (
        <Mono>{c.getValue() as string}</Mono>
      ) : (
        <span className="text-fg-3">Draft</span>
      ),
  },
  {
    accessorKey: "dnNo",
    header: "Debit note",
    cell: (c) => (c.getValue() ? <Mono>{c.getValue() as string}</Mono> : "—"),
  },
  { accessorKey: "date", header: "Date" },
  {
    accessorKey: "supplierName",
    header: "Supplier",
    cell: (c) => <span className="font-medium">{c.getValue() as string}</span>,
  },
  { accessorKey: "reason", header: "Reason" },
  { accessorKey: "rollCount", header: "Rolls", meta: { numeric: true } },
  {
    id: "total",
    header: "Total",
    meta: { numeric: true },
    accessorFn: (r) => r.totals.total,
    cell: (c) => (Number(c.getValue()) ? formatINR(c.getValue() as string) : "—"),
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: (c) => (
      <Badge tone={DOC_TONE[c.getValue() as PurchaseReturnItem["status"]]}>
        {c.getValue() as string}
      </Badge>
    ),
  },
];

function ReturnsPage() {
  const { data: me } = useQuery(meQuery);
  const { data, isLoading } = useQuery(returnListQuery);
  const navigate = useNavigate();
  return (
    <div className="grid gap-6">
      <PageHeader
        title="Purchase returns"
        description="Rolls sent back to the supplier. Posting issues the GST debit note."
        breadcrumbs={[{ label: "Purchase" }, { label: "Returns" }]}
        actions={
          can(me, "purchase.return.manage") ? (
            <Button asChild variant="primary" icon={Plus}>
              <Link to="/purchase/returns/new">New return</Link>
            </Button>
          ) : null
        }
      />
      <DataTable
        caption="Purchase returns"
        data={data ?? []}
        loading={isLoading}
        columns={columns}
        getRowId={(r) => r.id}
        onRowClick={(r) => void navigate({ to: "/purchase/returns/$prId", params: { prId: r.id } })}
        searchPlaceholder="Search returns"
      />
    </div>
  );
}
