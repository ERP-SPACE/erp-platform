import type { SiListItem } from "@erp/contracts";
import { Badge, Button, DataTable, Mono, PageHeader } from "@erp/ui";
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus } from "lucide-react";
import { can, meQuery } from "../../../../lib/queries.js";
import { DOC_TONE, IRN_TONE, STATUS_LABEL, siListQuery, rupees } from "../../../../lib/sales.js";

export const Route = createFileRoute("/_app/sales/invoices/")({ component: SiListPage });

const columns: ColumnDef<SiListItem, unknown>[] = [
  {
    accessorKey: "siNo",
    header: "Invoice",
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
    accessorKey: "total",
    header: "Total",
    meta: { numeric: true },
    cell: (c) => rupees(c.getValue() as string),
  },
  { accessorKey: "dueDate", header: "Due" },
  {
    accessorKey: "status",
    header: "Status",
    cell: (c) => (
      <Badge tone={DOC_TONE[c.getValue() as string] ?? "neutral"}>{c.getValue() as string}</Badge>
    ),
  },
  {
    accessorKey: "einvoiceStatus",
    header: "E-invoice",
    cell: (c) => {
      const s = c.getValue() as SiListItem["einvoiceStatus"];
      return s === "NotRequired" ? (
        <span className="text-fg-3">—</span>
      ) : (
        <Badge tone={IRN_TONE[s]}>{STATUS_LABEL[s] ?? s}</Badge>
      );
    },
  },
];

function SiListPage() {
  const { data: me } = useQuery(meQuery);
  const { data, isLoading } = useQuery(siListQuery());
  const navigate = useNavigate();
  return (
    <div className="grid gap-6">
      <PageHeader
        title="Sales invoices"
        description="Tax invoices to customers. B2B invoices get their IRN from the e-invoice portal after posting."
        breadcrumbs={[{ label: "Sales" }, { label: "Invoices" }]}
        actions={
          can(me, "sales.invoice.manage") ? (
            <Button asChild variant="primary" icon={Plus}>
              <Link to="/sales/invoices/new">New invoice</Link>
            </Button>
          ) : null
        }
      />
      <DataTable
        caption="Sales invoices"
        data={data ?? []}
        loading={isLoading}
        columns={columns}
        getRowId={(r) => r.id}
        onRowClick={(r) => void navigate({ to: "/sales/invoices/$siId", params: { siId: r.id } })}
        searchPlaceholder="Search invoice number or customer"
      />
    </div>
  );
}
