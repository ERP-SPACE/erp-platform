import type { NoteItem } from "@erp/contracts";
import { Badge, Button, DataTable, Mono, PageHeader } from "@erp/ui";
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus } from "lucide-react";
import { can, meQuery } from "../../../../lib/queries.js";
import {
  DOC_TONE,
  IRN_TONE,
  NOTE_REASON_LABEL,
  STATUS_LABEL,
  noteListQuery,
  rupees,
} from "../../../../lib/sales.js";

export const Route = createFileRoute("/_app/sales/notes/")({ component: NoteListPage });

const columns: ColumnDef<NoteItem, unknown>[] = [
  {
    accessorKey: "noteNo",
    header: "Note",
    cell: (c) =>
      c.getValue() ? (
        <Mono>{c.getValue() as string}</Mono>
      ) : (
        <span className="text-fg-3">Draft</span>
      ),
  },
  {
    accessorKey: "kind",
    header: "Kind",
    cell: (c) => (
      <Badge tone={c.getValue() === "CREDIT" ? "info" : "warning"}>
        {c.getValue() === "CREDIT" ? "Credit" : "Debit"}
      </Badge>
    ),
  },
  { accessorKey: "date", header: "Date" },
  {
    accessorKey: "customerName",
    header: "Customer",
    cell: (c) => <span className="font-medium">{c.getValue() as string}</span>,
  },
  {
    accessorKey: "reasonCode",
    header: "Reason",
    cell: (c) => NOTE_REASON_LABEL[c.getValue() as string],
  },
  {
    accessorKey: "siNo",
    header: "Against",
    cell: (c) => (c.getValue() ? <Mono className="text-xs">{c.getValue() as string}</Mono> : "—"),
  },
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
        <span className="flex gap-1.5">
          <Badge tone={DOC_TONE[r.status] ?? "neutral"}>{r.status}</Badge>
          {r.einvoiceStatus !== "NotRequired" ? (
            <Badge tone={IRN_TONE[r.einvoiceStatus]}>{STATUS_LABEL[r.einvoiceStatus]}</Badge>
          ) : null}
        </span>
      );
    },
  },
];

function NoteListPage() {
  const { data: me } = useQuery(meQuery);
  const { data, isLoading } = useQuery(noteListQuery());
  const navigate = useNavigate();
  return (
    <div className="grid gap-6">
      <PageHeader
        title="Credit & debit notes"
        description="Rate differences, discounts after billing and shortages. Returns issue their own credit notes."
        breadcrumbs={[{ label: "Sales" }, { label: "Credit & debit notes" }]}
        actions={
          can(me, "sales.note.manage") ? (
            <Button asChild variant="primary" icon={Plus}>
              <Link to="/sales/notes/new">New note</Link>
            </Button>
          ) : null
        }
      />
      <DataTable
        caption="Credit and debit notes"
        data={data ?? []}
        loading={isLoading}
        columns={columns}
        getRowId={(r) => r.id}
        onRowClick={(r) => void navigate({ to: "/sales/notes/$noteId", params: { noteId: r.id } })}
        searchPlaceholder="Search note, invoice or customer"
      />
    </div>
  );
}
