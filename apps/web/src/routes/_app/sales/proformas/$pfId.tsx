import type { ProformaDetail } from "@erp/contracts";
import { Button, Card, ConfirmDialog, DataTable, Mono, PageHeader, useToast } from "@erp/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { Pencil, ReceiptText, Send, XCircle } from "lucide-react";
import { useState } from "react";
import { ProformaForm } from "../../../../components/proforma-form.js";
import { DocTitle, PdfButton, TotalsCard, crumbLink } from "../../../../components/sales-bits.js";
import { useApiErrorToast } from "../../../../lib/errors.js";
import { can, keys, meQuery } from "../../../../lib/queries.js";
import { DOC_TONE, docAction, metres, pfQuery, rupees } from "../../../../lib/sales.js";

export const Route = createFileRoute("/_app/sales/proformas/$pfId")({ component: PfPage });

type Line = ProformaDetail["lines"][number];
const columns: ColumnDef<Line, unknown>[] = [
  {
    accessorKey: "description",
    header: "Product",
    cell: (c) => <span className="font-medium">{c.getValue() as string}</span>,
  },
  {
    accessorKey: "hsnCode",
    header: "HSN",
    cell: (c) => <Mono className="text-xs">{(c.getValue() as string) ?? "—"}</Mono>,
  },
  {
    accessorKey: "metres",
    header: "Metres",
    meta: { numeric: true },
    cell: (c) => metres(c.getValue() as number),
  },
  { accessorKey: "ratePerM", header: "Rate ₹/m", meta: { numeric: true } },
  { accessorKey: "discountPct", header: "Disc. %", meta: { numeric: true } },
  {
    accessorKey: "taxable",
    header: "Taxable",
    meta: { numeric: true },
    cell: (c) => rupees(c.getValue() as string),
  },
];

function PfPage() {
  const { pfId } = Route.useParams();
  const { data: me } = useQuery(meQuery);
  const { data: pf } = useQuery(pfQuery(pfId));
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const queryClient = useQueryClient();
  const toast = useToast();
  const onError = useApiErrorToast();
  const act = useMutation({
    mutationFn: (a: "send" | "cancel") =>
      docAction<ProformaDetail>(`/api/proformas/{id}/${a}`, pfId, { version: pf!.version }),
    onSuccess: async (saved) => {
      setConfirm(false);
      toast({
        tone: "success",
        title: saved.status === "Sent" ? "Marked as sent" : "Proforma cancelled",
      });
      await queryClient.invalidateQueries({ queryKey: keys.sales });
    },
    onError: (e) => onError(e, keys.sales),
  });
  if (!pf) return null;
  const crumbs = [
    { label: "Sales" },
    { label: "Proformas", href: "/sales/proformas" },
    { label: pf.proformaNo },
  ];
  if (editing) {
    return (
      <div className="grid gap-6">
        <PageHeader
          title={
            <>
              Edit <Mono>{pf.proformaNo}</Mono>
            </>
          }
          breadcrumbs={crumbs}
          renderLink={crumbLink}
        />
        <ProformaForm pf={pf} onDone={() => setEditing(false)} />
      </div>
    );
  }
  const manage = can(me, "sales.order.manage");
  const live = pf.status === "Draft" || pf.status === "Sent";
  return (
    <div className="grid gap-6">
      <PageHeader
        title={
          <DocTitle
            number={pf.proformaNo}
            draftLabel="Proforma"
            status={pf.status}
            tone={DOC_TONE[pf.status] ?? "neutral"}
          />
        }
        description={`${pf.customerName} · ${pf.date} · valid until ${pf.validUntil}`}
        breadcrumbs={crumbs}
        renderLink={crumbLink}
        actions={
          <>
            <PdfButton kind="proformas" id={pf.id} />
            {live && manage ? (
              <>
                <Button variant="secondary" icon={Pencil} onClick={() => setEditing(true)}>
                  Edit
                </Button>
                <Button variant="secondary" icon={XCircle} onClick={() => setConfirm(true)}>
                  Cancel
                </Button>
              </>
            ) : null}
            {pf.status === "Draft" && manage ? (
              <Button
                variant="secondary"
                icon={Send}
                busy={act.isPending}
                onClick={() => act.mutate("send")}
              >
                Mark as sent
              </Button>
            ) : null}
            {live && can(me, "sales.invoice.manage") ? (
              <Button asChild variant="primary" icon={ReceiptText}>
                <Link to="/sales/invoices/new" search={{ source: "PROFORMA", proformaId: pf.id }}>
                  Convert to invoice
                </Link>
              </Button>
            ) : null}
            {pf.convertedSiId ? (
              <Button asChild variant="secondary" icon={ReceiptText}>
                <Link to="/sales/invoices/$siId" params={{ siId: pf.convertedSiId }}>
                  Invoice {pf.convertedSiNo}
                </Link>
              </Button>
            ) : null}
          </>
        }
      />
      <div className="grid gap-6 [&>*]:min-w-0 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Card title="Lines" padded={false}>
          <DataTable
            caption="Proforma lines"
            data={pf.lines}
            columns={columns}
            getRowId={(l) => l.id}
            pageSize={false}
          />
        </Card>
        <TotalsCard totals={pf.totals} />
      </div>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Cancel this proforma?"
        confirmLabel="Cancel proforma"
        tone="danger"
        busy={act.isPending}
        onConfirm={() => act.mutate("cancel")}
      />
    </div>
  );
}
