import type { GrnListItem } from "@erp/contracts";
import { Badge, Button, DataTable, Mono, PageHeader } from "@erp/ui";
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus } from "lucide-react";
import { DOC_TONE, grnListQuery } from "../../../../lib/purchase.js";
import { can, meQuery } from "../../../../lib/queries.js";

export const Route = createFileRoute("/_app/purchase/receipts/")({ component: GrnListPage });

const columns: ColumnDef<GrnListItem, unknown>[] = [
  { accessorKey: "grnNo", header: "GRN", cell: (c) => <Mono>{c.getValue() as string}</Mono> },
  { accessorKey: "date", header: "Date" },
  {
    accessorKey: "supplierName",
    header: "Supplier",
    cell: (c) => <span className="font-medium">{c.getValue() as string}</span>,
  },
  {
    accessorKey: "poNo",
    header: "PO",
    cell: (c) => (c.getValue() ? <Mono>{c.getValue() as string}</Mono> : "—"),
  },
  { accessorKey: "rollCount", header: "Rolls", meta: { numeric: true } },
  {
    accessorKey: "acceptedM",
    header: "Metres",
    meta: { numeric: true },
    cell: (c) => `${(c.getValue() as number).toLocaleString("en-IN")} m`,
  },
  {
    accessorKey: "unmappedRolls",
    header: "Unmapped",
    meta: { numeric: true },
    cell: (c) =>
      (c.getValue() as number) ? <Badge tone="warning">{c.getValue() as number}</Badge> : "—",
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: (c) => (
      <Badge tone={DOC_TONE[c.getValue() as GrnListItem["status"]]}>{c.getValue() as string}</Badge>
    ),
  },
];

function GrnListPage() {
  const { data: me } = useQuery(meQuery);
  const { data, isLoading } = useQuery(grnListQuery);
  const navigate = useNavigate();
  return (
    <div className="grid gap-6">
      <PageHeader
        title="Goods receipts"
        description="Paper that has arrived. Posting a receipt creates one barcoded roll per physical roll."
        breadcrumbs={[{ label: "Purchase" }, { label: "Goods receipts" }]}
        actions={
          can(me, "purchase.receipt.manage") ? (
            <Button asChild variant="primary" icon={Plus}>
              <Link to="/purchase/receipts/new">Receive goods</Link>
            </Button>
          ) : null
        }
      />
      <DataTable
        caption="Goods receipts"
        data={data ?? []}
        loading={isLoading}
        columns={columns}
        getRowId={(r) => r.id}
        onRowClick={(r) =>
          void navigate({ to: "/purchase/receipts/$grnId", params: { grnId: r.id } })
        }
        searchPlaceholder="Search GRN, supplier, bill no., lot"
      />
    </div>
  );
}
