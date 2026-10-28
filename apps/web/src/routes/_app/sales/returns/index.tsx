import type { SalesReturnItem } from "@erp/contracts";
import { Badge, Button, DataTable, Mono, PageHeader } from "@erp/ui";
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus } from "lucide-react";
import { can, meQuery } from "../../../../lib/queries.js";
import { DOC_TONE, metres, srListQuery, rupees, count } from "../../../../lib/sales.js";

export const Route = createFileRoute("/_app/sales/returns/")({ component: SrListPage });

const columns: ColumnDef<SalesReturnItem, unknown>[] = [
  {
    accessorKey: "srNo",
    header: "Return",
    cell: (c) =>
      c.getValue() ? (
        <Mono>{c.getValue() as string}</Mono>
      ) : (
        <span className="text-fg-3">Draft</span>
      ),
  },
  { accessorKey: "date", header: "Date" },
  {
    accessorKey: "customerName",
    header: "Customer",
    cell: (c) => <span className="font-medium">{c.getValue() as string}</span>,
  },
  {
    accessorKey: "siNo",
    header: "Invoice",
    cell: (c) => <Mono className="text-xs">{c.getValue() as string}</Mono>,
  },
  {
    id: "rolls",
    header: "Came back",
    meta: { numeric: true },
    accessorFn: (r) => r.returnedM,
    cell: (c) => `${count(c.row.original.rollCount, "roll")} · ${metres(c.row.original.returnedM)}`,
  },
  {
    accessorKey: "total",
    header: "Credit",
    meta: { numeric: true },
    cell: (c) => rupees(c.getValue() as string),
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: (c) => {
      const r = c.row.original;
      return (
        <span className="flex gap-1.5">
          <Badge tone={DOC_TONE[r.status] ?? "neutral"}>{r.status}</Badge>
          {r.awaitingInspection ? (
            <Badge tone="warning">{r.awaitingInspection} to inspect</Badge>
          ) : null}
        </span>
      );
    },
  },
];

function SrListPage() {
  const { data: me } = useQuery(meQuery);
  const { data, isLoading } = useQuery(srListQuery());
  const navigate = useNavigate();
  return (
    <div className="grid gap-6">
      <PageHeader
        title="Sales returns"
        description="Rolls customers send back. Posting issues the credit note; each roll is then inspected — back to stock or scrap."
        breadcrumbs={[{ label: "Sales" }, { label: "Returns" }]}
        actions={
          can(me, "sales.return.manage") ? (
            <Button asChild variant="primary" icon={Plus}>
              <Link to="/sales/returns/new">New return</Link>
            </Button>
          ) : null
        }
      />
      <DataTable
        caption="Sales returns"
        data={data ?? []}
        loading={isLoading}
        columns={columns}
        getRowId={(r) => r.id}
        onRowClick={(r) => void navigate({ to: "/sales/returns/$srId", params: { srId: r.id } })}
        searchPlaceholder="Search return, invoice or customer"
      />
    </div>
  );
}
