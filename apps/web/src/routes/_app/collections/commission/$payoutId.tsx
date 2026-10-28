import type { CommissionEntryItem, PayoutDetail } from "@erp/contracts";
import { istToday } from "@erp/domain";
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  DataTable,
  DefinitionList,
  Dialog,
  Field,
  Mono,
  NumberInput,
  PageHeader,
  Select,
  TextInput,
  useToast,
} from "@erp/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { CheckCircle2, FileDown, XCircle } from "lucide-react";
import { useState } from "react";
import { DocTitle, crumbLink } from "../../../../components/sales-bits.js";
import { api, call } from "../../../../lib/api.js";
import { openAccountPdf, payoutQuery } from "../../../../lib/collections.js";
import { useApiErrorToast } from "../../../../lib/errors.js";
import { can, keys, meQuery } from "../../../../lib/queries.js";
import { docAction, rupees } from "../../../../lib/sales.js";

export const Route = createFileRoute("/_app/collections/commission/$payoutId")({
  component: PayoutPage,
});

const columns: ColumnDef<CommissionEntryItem, unknown>[] = [
  { accessorKey: "date", header: "Date" },
  { accessorKey: "customerName", header: "Customer" },
  {
    accessorKey: "invoiceNo",
    header: "Invoice",
    cell: (c) => <Mono>{c.getValue() as string}</Mono>,
  },
  {
    id: "basis",
    header: "Basis",
    cell: (c) =>
      c.row.original.reversalReason ??
      (c.row.original.method === "PERCENT_SALES"
        ? `${c.row.original.rate} % of sales`
        : `₹${c.row.original.rate}/m`),
  },
  {
    accessorKey: "amount",
    header: "Commission",
    meta: { numeric: true },
    cell: (c) => (
      <span className={Number(c.getValue()) < 0 ? "text-danger" : undefined}>
        {rupees(c.getValue() as string)}
      </span>
    ),
  },
];

function PayoutPage() {
  const { payoutId } = Route.useParams();
  const { data: me } = useQuery(meQuery);
  const { data: p } = useQuery(payoutQuery(payoutId));
  const [dialog, setDialog] = useState<"pay" | "cancel" | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const queryClient = useQueryClient();
  const toast = useToast();
  const onError = useApiErrorToast();
  const cancel = useMutation({
    mutationFn: () =>
      docAction<PayoutDetail>("/api/commission/payouts/{id}/cancel", payoutId, {
        version: p!.version,
      }),
    onSuccess: async () => {
      setDialog(null);
      toast({ tone: "success", title: "Payout cancelled" });
      await queryClient.invalidateQueries({ queryKey: keys.collections });
    },
    onError: (e) => onError(e, keys.collections),
  });
  if (!p) return null;
  const draft = p.status === "Draft";
  const manage = can(me, "commission.payout.manage");
  return (
    <div className="grid gap-6">
      <PageHeader
        title={
          <DocTitle
            number={draft ? null : p.payoutNo}
            draftLabel="Draft payout"
            status={p.status}
            tone={p.status === "Paid" ? "success" : p.status === "Draft" ? "neutral" : "danger"}
          />
        }
        description={`${p.salesmanName} · commission up to ${p.upTo}`}
        breadcrumbs={[
          { label: "Collections" },
          { label: "Commission", href: "/collections/commission" },
          { label: draft ? "Draft" : p.payoutNo },
        ]}
        renderLink={crumbLink}
        actions={
          <>
            <Button
              variant="secondary"
              icon={FileDown}
              busy={pdfBusy}
              onClick={() => {
                setPdfBusy(true);
                openAccountPdf(`/api/commission/payouts/${p.id}/pdf`)
                  .catch((e: unknown) => onError(e))
                  .finally(() => setPdfBusy(false));
              }}
            >
              Advice PDF
            </Button>
            {draft && manage ? (
              <>
                <Button variant="secondary" icon={XCircle} onClick={() => setDialog("cancel")}>
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  icon={CheckCircle2}
                  disabled={Number(p.gross) <= 0}
                  onClick={() => setDialog("pay")}
                >
                  Pay {rupees(p.gross)}
                </Button>
              </>
            ) : null}
          </>
        }
      />
      <div className="grid gap-6 [&>*]:min-w-0 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Card title={`Entries · ${p.entryCount}`} padded={false}>
          <DataTable
            caption="Payout entries"
            data={p.entries}
            columns={columns}
            getRowId={(r) => r.id}
            empty="Nothing earned up to this date."
          />
        </Card>
        <div className="grid content-start gap-6">
          <Card title="Payout">
            <dl className="grid gap-1.5 text-sm">
              <div className="flex justify-between">
                <dt className="text-fg-2">Gross</dt>
                <dd className="tnum">{rupees(p.gross)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-fg-2">TDS</dt>
                <dd className="tnum">{rupees(p.tds)}</dd>
              </div>
              <div className="mt-1 flex justify-between border-t border-border pt-2 text-base font-semibold">
                <dt>Net</dt>
                <dd className="tnum">{rupees(p.net)}</dd>
              </div>
            </dl>
            {draft ? (
              <p className="mt-2 text-xs text-fg-3">
                Recalculated when you pay, from what is earned by then.
              </p>
            ) : null}
          </Card>
          {!draft ? (
            <Card>
              <DefinitionList
                columns={1}
                items={[
                  { label: "Paid on", value: p.paidOn ?? "—" },
                  {
                    label: "Mode",
                    value: p.mode ? `${p.mode}${p.reference ? ` · ${p.reference}` : ""}` : "—",
                  },
                  {
                    label: "Status",
                    value: (
                      <Badge tone={p.status === "Paid" ? "success" : "danger"}>{p.status}</Badge>
                    ),
                  },
                ]}
              />
            </Card>
          ) : null}
        </div>
      </div>
      {dialog === "pay" ? <PayDialog payout={p} onClose={() => setDialog(null)} /> : null}
      <ConfirmDialog
        open={dialog === "cancel"}
        onOpenChange={(o) => !o && setDialog(null)}
        title="Cancel this payout?"
        description="Nothing is paid; the commission stays to be paid."
        confirmLabel="Cancel payout"
        tone="danger"
        busy={cancel.isPending}
        onConfirm={() => cancel.mutate()}
      />
    </div>
  );
}

function PayDialog({ payout, onClose }: { payout: PayoutDetail; onClose: () => void }) {
  const [paidOn, setPaidOn] = useState(istToday());
  const [mode, setMode] = useState<"NEFT" | "RTGS" | "UPI" | "CHEQUE" | "CASH">("NEFT");
  const [reference, setReference] = useState("");
  const [tds, setTds] = useState("");
  const queryClient = useQueryClient();
  const toast = useToast();
  const onError = useApiErrorToast();
  const pay = useMutation({
    mutationFn: () =>
      call<PayoutDetail>(() =>
        api.POST("/api/commission/payouts/{id}/pay", {
          params: { path: { id: payout.id } },
          body: {
            version: payout.version,
            paidOn,
            mode,
            reference: reference || null,
            ...(tds ? { tds } : {}),
          },
        }),
      ),
    onSuccess: async (p) => {
      toast({
        tone: "success",
        title: `Paid as ${p.payoutNo}`,
        description: `${rupees(p.net)} to ${p.salesmanName}.`,
      });
      await queryClient.invalidateQueries({ queryKey: keys.collections });
      onClose();
    },
    onError: (e) => onError(e, keys.collections),
  });
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Pay ${payout.salesmanName}`}
      description={`${rupees(payout.gross)} earned up to ${payout.upTo}.`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Back
          </Button>
          <Button variant="primary" busy={pay.isPending} onClick={() => pay.mutate()}>
            Mark as paid
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Paid on" required>
          {(p) => (
            <TextInput
              {...p}
              type="date"
              value={paidOn}
              onChange={(e) => setPaidOn(e.target.value)}
            />
          )}
        </Field>
        <Field label="Mode" required>
          {(p) => (
            <Select
              {...p}
              value={mode}
              onValueChange={(v) => setMode(v as typeof mode)}
              options={["NEFT", "RTGS", "UPI", "CHEQUE", "CASH"].map((m) => ({
                value: m,
                label: m,
              }))}
            />
          )}
        </Field>
        <Field label="Reference">
          {(p) => (
            <TextInput {...p} value={reference} onChange={(e) => setReference(e.target.value)} />
          )}
        </Field>
        <Field label="TDS deducted" hint="Optional">
          {(p) => <NumberInput {...p} prefix="₹" decimals={2} value={tds} onValueChange={setTds} />}
        </Field>
      </div>
    </Dialog>
  );
}
