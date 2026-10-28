import type { DcListItem } from "@erp/contracts";
import { Badge, DataTable, Mono, PageHeader } from "@erp/ui";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { DC_TONE, dcListQuery, metres, count } from "../../../../lib/sales.js";

export const Route = createFileRoute("/_app/sales/challans/")({ component: DcListPage });

const columns: ColumnDef<DcListItem, unknown>[] = [
  { accessorKey: "dcNo", header: "Challan", cell: (c) => <Mono>{c.getValue() as string}</Mono> },
  { accessorKey: "date", header: "Date" },
  {
    accessorKey: "customerName",
    header: "Customer",
    cell: (c) => <span className="font-medium">{c.getValue() as string}</span>,
  },
  {
    accessorKey: "soNo",
    header: "Order",
    cell: (c) => <Mono className="text-xs">{c.getValue() as string}</Mono>,
  },
  {
    id: "rolls",
    header: "Rolls",
    meta: { numeric: true },
    accessorFn: (r) => r.metres,
    cell: (c) => `${count(c.row.original.rollCount, "roll")} · ${metres(c.row.original.metres)}`,
  },
  { accessorKey: "vehicleNo", header: "Vehicle", cell: (c) => (c.getValue() as string) ?? "—" },
  {
    accessorKey: "status",
    header: "Status",
    cell: (c) => {
      const r = c.row.original;
      return (
        <span className="flex gap-1.5">
          <Badge tone={DC_TONE[r.status]}>{r.status === "Open" ? "Dispatched" : r.status}</Badge>
          {r.status === "Open" && !r.invoiced ? <Badge tone="warning">To invoice</Badge> : null}
        </span>
      );
    },
  },
];

function DcListPage() {
  const { data, isLoading } = useQuery(dcListQuery());
  const navigate = useNavigate();
  return (
    <div className="grid gap-6">
      <PageHeader
        title="Delivery challans"
        description="Rolls picked against an order and sent out. Start one from a confirmed order."
        breadcrumbs={[{ label: "Sales" }, { label: "Challans" }]}
      />
      <DataTable
        caption="Delivery challans"
        data={data ?? []}
        loading={isLoading}
        columns={columns}
        getRowId={(r) => r.id}
        onRowClick={(r) => void navigate({ to: "/sales/challans/$dcId", params: { dcId: r.id } })}
        searchPlaceholder="Search challan, order or customer"
      />
    </div>
  );
}
