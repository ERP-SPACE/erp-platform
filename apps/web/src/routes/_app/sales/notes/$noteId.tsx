import type { EInvoiceInfo, NoteDetail } from "@erp/contracts";
import { Badge, Button, Card, ConfirmDialog, DataTable, Mono, PageHeader, useToast } from "@erp/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { CheckCircle2, RefreshCw, XCircle } from "lucide-react";
import { useState } from "react";
import {
  DocTitle,
  EInvoiceCard,
  PdfButton,
  ReasonDialog,
  TotalsCard,
  crumbLink,
} from "../../../../components/sales-bits.js";
import { ApiError, api, call } from "../../../../lib/api.js";
import { useApiErrorToast } from "../../../../lib/errors.js";
import { can, keys, meQuery } from "../../../../lib/queries.js";
import {
  DOC_TONE,
  NOTE_REASON_LABEL,
  docAction,
  noteQuery,
  rupees,
} from "../../../../lib/sales.js";

export const Route = createFileRoute("/_app/sales/notes/$noteId")({ component: NotePage });

type Line = NoteDetail["lines"][number];
const columns: ColumnDef<Line, unknown>[] = [
  {
    accessorKey: "description",
    header: "Description",
    cell: (c) => <span className="font-medium">{c.getValue() as string}</span>,
  },
  {
    accessorKey: "hsnCode",
    header: "HSN",
    cell: (c) => <Mono className="text-xs">{c.getValue() as string}</Mono>,
  },
  {
    accessorKey: "taxable",
    header: "Taxable",
    meta: { numeric: true },
    cell: (c) => rupees(c.getValue() as string),
  },
  {
    accessorKey: "gstRate",
    header: "GST",
    meta: { numeric: true },
    cell: (c) => `${c.getValue() as string} %`,
  },
];

function NotePage() {
  const { noteId } = Route.useParams();
  const { data: me } = useQuery(meQuery);
  const { data: n } = useQuery(noteQuery(noteId));
  const [dialog, setDialog] = useState<"post" | "discard" | "cancel" | null>(null);
  const queryClient = useQueryClient();
  const toast = useToast();
  const onError = useApiErrorToast();
  const act = useMutation({
    mutationFn: ({ reason }: { reason?: string }) =>
      docAction<NoteDetail>(
        `/api/customer-notes/{id}/${dialog === "post" ? "post" : "cancel"}`,
        noteId,
        { version: n!.version },
        reason,
      ),
    onSuccess: async (saved) => {
      setDialog(null);
      toast({
        tone: "success",
        title: saved.status === "Posted" ? `Posted as ${saved.noteNo}` : "Note cancelled",
      });
      await queryClient.invalidateQueries({ queryKey: keys.sales });
    },
    onError: (e) => onError(e, keys.sales),
  });
  const docType = n?.kind === "DEBIT" ? "DN" : "CN";
  const retry = useMutation({
    mutationFn: () =>
      call<EInvoiceInfo>(() =>
        api.POST("/api/einvoice/{docType}/{id}/generate", {
          params: { path: { docType, id: noteId } },
        }),
      ),
    onSuccess: async () => {
      toast({ tone: "success", title: "IRN generated" });
      await queryClient.invalidateQueries({ queryKey: keys.sales });
    },
    onError: async (e) => {
      toast({
        tone: "danger",
        title: "The portal didn't accept it",
        description: e instanceof ApiError ? e.problem.title : undefined,
      });
      await queryClient.invalidateQueries({ queryKey: keys.sales });
    },
  });
  if (!n) return null;
  const manage = can(me, "sales.note.manage");
  const title = n.kind === "CREDIT" ? "Credit note" : "Debit note";
  return (
    <div className="grid gap-6">
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            <DocTitle
              number={n.noteNo}
              draftLabel={`Draft ${title.toLowerCase()}`}
              status={n.status}
              tone={DOC_TONE[n.status] ?? "neutral"}
            />
            <Badge tone={n.kind === "CREDIT" ? "info" : "warning"}>{title}</Badge>
          </span>
        }
        description={
          <>
            {n.customerName} · {n.date} · {NOTE_REASON_LABEL[n.reasonCode]}: {n.reason}
            {n.siId ? (
              <>
                {" · against "}
                <Link
                  to="/sales/invoices/$siId"
                  params={{ siId: n.siId }}
                  className="text-primary hover:underline"
                >
                  <Mono>{n.siNo}</Mono>
                </Link>
              </>
            ) : null}
          </>
        }
        breadcrumbs={[
          { label: "Sales" },
          { label: "Credit & debit notes", href: "/sales/notes" },
          { label: n.noteNo ?? "Draft" },
        ]}
        renderLink={crumbLink}
        actions={
          <>
            <PdfButton kind="customer-notes" id={n.id} />
            {n.status === "Draft" && manage ? (
              <>
                <Button variant="secondary" icon={XCircle} onClick={() => setDialog("discard")}>
                  Discard
                </Button>
                <Button variant="primary" icon={CheckCircle2} onClick={() => setDialog("post")}>
                  Post {title.toLowerCase()}
                </Button>
              </>
            ) : null}
            {n.status === "Posted" && !n.salesReturnId && can(me, "sales.invoice.cancel") ? (
              <Button variant="secondary" icon={XCircle} onClick={() => setDialog("cancel")}>
                Cancel
              </Button>
            ) : null}
          </>
        }
      />
      <div className="grid gap-6 [&>*]:min-w-0 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Card title="Lines" padded={false}>
          <DataTable
            caption="Note lines"
            data={n.lines}
            columns={columns}
            getRowId={(l) => l.description + l.taxable}
            pageSize={false}
          />
        </Card>
        <div className="grid content-start gap-6">
          <TotalsCard totals={n.totals} />
          {n.status !== "Draft" ? (
            <EInvoiceCard
              info={n.einvoice}
              actions={
                can(me, "compliance.einvoice.manage") &&
                n.status === "Posted" &&
                (n.einvoice.status === "Pending" || n.einvoice.status === "Failed") ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={RefreshCw}
                    busy={retry.isPending}
                    onClick={() => retry.mutate()}
                  >
                    Retry now
                  </Button>
                ) : null
              }
            />
          ) : null}
        </div>
      </div>
      <ConfirmDialog
        open={dialog === "post" || dialog === "discard"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={dialog === "post" ? `Post this ${title.toLowerCase()}?` : "Discard this draft?"}
        description={
          dialog === "post"
            ? `It gets its number and ${rupees(n.totals.total)} ${n.kind === "CREDIT" ? "comes off" : "is added to"} ${n.customerName}'s account.`
            : undefined
        }
        confirmLabel={dialog === "post" ? "Post" : "Discard"}
        tone={dialog === "discard" ? "danger" : "primary"}
        busy={act.isPending}
        onConfirm={() => act.mutate({})}
      />
      <ReasonDialog
        open={dialog === "cancel"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={`Cancel ${n.noteNo}?`}
        description="Possible within 24 hours of its IRN; the IRN is cancelled on the portal too."
        confirmLabel="Cancel note"
        tone="danger"
        busy={act.isPending}
        onConfirm={(reason) => act.mutate({ reason })}
      />
    </div>
  );
}
