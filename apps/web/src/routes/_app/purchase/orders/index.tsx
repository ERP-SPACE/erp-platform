import type { PoListItem } from "@erp/contracts";
import { formatINR } from "@erp/domain";
import { Badge, Button, DataTable, Mono, PageHeader } from "@erp/ui";
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus } from "lucide-react";
import { PO_TONE, ROLL_LABEL, poListQuery } from "../../../../lib/purchase.js";
import { can, meQuery } from "../../../../lib/queries.js";

export const Route = createFileRoute("/_app/purchase/orders/")({ component: PoListPage });

const columns: ColumnDef<PoListItem, unknown>[] = [
  { accessorKey: "poNo", header: "PO", cell: (c) => <Mono>{c.getValue() as string}</Mono> },
  { accessorKey: "date", header: "Date" },
  {
    accessorKey: "supplierName",
    header: "Supplier",
    cell: (c) => <span className="font-medium">{c.getValue() as string}</span>,
  },
  {
    id: "progress",
    header: "Received",
    meta: { numeric: true },
    accessorFn: (r) => r.receivedM,
    cell: (c) =>
      `${c.row.original.receivedM.toLocaleString("en-IN")} / ${c.row.original.orderedM.toLocaleString("en-IN")} m`,
  },
  {
    accessorKey: "taxable",
    header: "Value (excl. GST)",
    meta: { numeric: true },
    cell: (c) => formatINR(c.getValue() as string),
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: (c) => {
      const s = c.getValue() as PoListItem["status"];
      return <Badge tone={PO_TONE[s]}>{ROLL_LABEL[s] ?? s}</Badge>;
    },
  },
];

function PoListPage() {
  const { data: me } = useQuery(meQuery);
  const { data, isLoading } = useQuery(poListQuery);
  const navigate = useNavigate();
  return (
    <div className="grid gap-6">
      <PageHeader
        title="Purchase orders"
        description="What you've ordered from suppliers. Goods receipts are recorded against these."
        breadcrumbs={[{ label: "Purchase" }, { label: "Purchase orders" }]}
        actions={
          can(me, "purchase.order.manage") ? (
            <Button asChild variant="primary" icon={Plus}>
              <Link to="/purchase/orders/new">New purchase order</Link>
            </Button>
          ) : null
        }
      />
      <DataTable
        caption="Purchase orders"
        data={data ?? []}
        loading={isLoading}
        columns={columns}
        getRowId={(r) => r.id}
        onRowClick={(r) => void navigate({ to: "/purchase/orders/$poId", params: { poId: r.id } })}
        searchPlaceholder="Search PO number or supplier"
      />
    </div>
  );
}
