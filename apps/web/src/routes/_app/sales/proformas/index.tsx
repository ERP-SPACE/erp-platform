import type { ProformaListItem } from "@erp/contracts";
import { Badge, Button, DataTable, Mono, PageHeader } from "@erp/ui";
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus } from "lucide-react";
import { can, meQuery } from "../../../../lib/queries.js";
import { DOC_TONE, pfListQuery, rupees } from "../../../../lib/sales.js";

export const Route = createFileRoute("/_app/sales/proformas/")({ component: PfListPage });

const columns: ColumnDef<ProformaListItem, unknown>[] = [
  {
    accessorKey: "proformaNo",
    header: "Proforma",
    cell: (c) => <Mono>{c.getValue() as string}</Mono>,
  },
  { accessorKey: "date", header: "Date" },
  {
    accessorKey: "customerName",
    header: "Customer",
    cell: (c) => <span className="font-medium">{c.getValue() as string}</span>,
  },
  { accessorKey: "validUntil", header: "Valid until" },
  {
    accessorKey: "total",
    header: "Total",
    meta: { numeric: true },
    cell: (c) => rupees(c.getValue() as string),
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: (c) => {
      const r = c.row.original;
      return (
        <span className="flex items-center gap-2">
          <Badge tone={DOC_TONE[r.status] ?? "neutral"}>{r.status}</Badge>
          {r.convertedSiNo ? <Mono className="text-xs text-fg-3">→ {r.convertedSiNo}</Mono> : null}
        </span>
      );
    },
  },
];

function PfListPage() {
  const { data: me } = useQuery(meQuery);
  const { data, isLoading } = useQuery(pfListQuery());
  const navigate = useNavigate();
  return (
    <div className="grid gap-6">
      <PageHeader
        title="Proformas"
        description="Quotations and advance-payment bills. No stock is held; convert one to a tax invoice when the goods go."
        breadcrumbs={[{ label: "Sales" }, { label: "Proformas" }]}
        actions={
          can(me, "sales.order.manage") ? (
            <Button asChild variant="primary" icon={Plus}>
              <Link to="/sales/proformas/new">New proforma</Link>
            </Button>
          ) : null
        }
      />
      <DataTable
        caption="Proformas"
        data={data ?? []}
        loading={isLoading}
        columns={columns}
        getRowId={(r) => r.id}
        onRowClick={(r) => void navigate({ to: "/sales/proformas/$pfId", params: { pfId: r.id } })}
        searchPlaceholder="Search proforma number or customer"
      />
    </div>
  );
}
