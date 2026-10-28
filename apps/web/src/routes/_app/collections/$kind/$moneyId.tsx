import type { ReceiptDetail } from "@erp/contracts";
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  DefinitionList,
  Dialog,
  Field,
  Mono,
  PageHeader,
  Segmented,
  TextInput,
  useToast,
} from "@erp/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute, notFound } from "@tanstack/react-router";
import { CheckCircle2, FileDown, Undo2, XCircle } from "lucide-react";
import { useState } from "react";
import { DocTitle, crumbLink } from "../../../../components/sales-bits.js";
import {
  KIND,
  MODE_LABEL,
  MONEY_TONE,
  type MoneyKind,
  moneyQuery,
  openAccountPdf,
} from "../../../../lib/collections.js";
import { useApiErrorToast } from "../../../../lib/errors.js";
import { dateTime } from "../../../../lib/format.js";
import { can, keys, meQuery } from "../../../../lib/queries.js";
import { docAction, rupees } from "../../../../lib/sales.js";

export const Route = createFileRoute("/_app/collections/$kind/$moneyId")({
  params: {
    parse: (p) => {
      if (p.kind !== "receipts" && p.kind !== "payments") throw notFound();
      return { kind: p.kind as MoneyKind, moneyId: p.moneyId };
    },
    stringify: (p) => p,
  },
  component: MoneyPage,
});

function MoneyPage() {
  const { kind, moneyId } = Route.useParams();
  const k = KIND[kind];
  const { data: me } = useQuery(meQuery);
  const { data: r } = useQuery(moneyQuery(kind, moneyId));
  const [dialog, setDialog] = useState<"post" | "cancel" | "reverse" | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const queryClient = useQueryClient();
  const toast = useToast();
  const onError = useApiErrorToast();
  const act = useMutation({
    mutationFn: (v: {
      action: "post" | "cancel" | "reverse";
      kind?: "BOUNCED" | "MISTAKE";
      reason?: string;
    }) =>
      docAction<ReceiptDetail>(
        `${k.path}/{id}/${v.action}` as `/api/${string}/{id}/${string}`,
        moneyId,
        { version: r!.version, ...(v.kind ? { kind: v.kind } : {}) },
        v.reason,
      ),
    onSuccess: async (saved) => {
      setDialog(null);
      toast({
        tone: "success",
        title:
          saved.status === "Posted"
            ? `Posted as ${saved.docNo}`
            : saved.status === "Reversed"
              ? `${saved.docNo} reversed — the invoices owe again`
              : "Draft discarded",
      });
      await queryClient.invalidateQueries({ queryKey: keys.collections });
      await queryClient.invalidateQueries({ queryKey: keys.sales });
    },
    onError: (e) => onError(e, keys.collections),
  });
  if (!r) return null;
  const manage = can(me, k.manage);
  const partyHref =
    kind === "receipts"
      ? { to: "/customers/$customerId" as const, params: { customerId: r.partyId } }
      : null;
  return (
    <div className="grid gap-6">
      <PageHeader
        title={
          <DocTitle
            number={r.docNo}
            draftLabel={`Draft ${k.one.toLowerCase()}`}
            status={r.status}
            tone={MONEY_TONE[r.status]}
          />
        }
        description={
          <>
            {partyHref ? (
              <Link {...partyHref} className="font-medium text-primary hover:underline">
                {r.partyName}
              </Link>
            ) : (
              r.partyName
            )}
            {` · ${r.date} · ${MODE_LABEL[r.mode]}${r.reference ? ` ${r.reference}` : ""}`}
          </>
        }
        breadcrumbs={[
          { label: "Collections" },
          { label: k.title, href: `/collections/${kind}` },
          { label: r.docNo ?? "Draft" },
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
                openAccountPdf(`${k.path}/${r.id}/pdf`)
                  .catch((e: unknown) => onError(e))
                  .finally(() => setPdfBusy(false));
              }}
            >
              {kind === "receipts" ? "Receipt PDF" : "Advice PDF"}
            </Button>
            {r.status === "Draft" && manage ? (
              <>
                <Button variant="secondary" icon={XCircle} onClick={() => setDialog("cancel")}>
                  Discard
                </Button>
                <Button variant="primary" icon={CheckCircle2} onClick={() => setDialog("post")}>
                  Post
                </Button>
              </>
            ) : null}
            {r.status === "Posted" && can(me, "collections.receipt.reverse") ? (
              <Button variant="secondary" icon={Undo2} onClick={() => setDialog("reverse")}>
                Reverse / bounced
              </Button>
            ) : null}
          </>
        }
      />
      {r.status === "Reversed" ? (
        <div className="rounded-lg border border-danger/30 bg-danger-soft p-3 text-sm text-danger">
          {r.reversalKind === "BOUNCED" ? "Cheque bounced" : "Reversed"} on {dateTime(r.reversedAt)}
          : {r.reversalReason}
        </div>
      ) : null}
      <div className="grid gap-6 [&>*]:min-w-0 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Card title="Applied to" padded={false}>
          {r.allocations.length ? (
            <table className="w-full text-sm">
              <thead className="bg-muted text-left text-xs uppercase tracking-wide text-fg-2">
                <tr>
                  <th className="px-4 py-2 font-medium">Invoice</th>
                  <th className="px-4 py-2 font-medium">Date</th>
                  <th className="px-4 py-2 text-right font-medium">Amount</th>
                  <th className="px-4 py-2 text-right font-medium">TDS</th>
                  <th className="px-4 py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {r.allocations.map((a) => (
                  <tr key={a.id} className="border-t border-border">
                    <td className="px-4 py-2">
                      {kind === "receipts" && !a.id.startsWith("draft-") ? (
                        <Link
                          to="/sales/invoices/$siId"
                          params={{ siId: a.invoiceId }}
                          className="text-primary hover:underline"
                        >
                          <Mono>{a.invoiceNo}</Mono>
                        </Link>
                      ) : (
                        <Mono>{a.invoiceNo}</Mono>
                      )}
                    </td>
                    <td className="px-4 py-2">{a.invoiceDate}</td>
                    <td className="tnum px-4 py-2 text-right">{rupees(a.amount)}</td>
                    <td className="tnum px-4 py-2 text-right">
                      {Number(a.deduction) ? rupees(a.deduction) : "—"}
                    </td>
                    <td className="px-4 py-2">
                      {a.reversedAt ? <Badge tone="danger">Reversed</Badge> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="px-4 py-6 text-sm text-fg-2">
              Not applied to any invoice — all of it is on account.
            </p>
          )}
        </Card>
        <div className="grid content-start gap-6">
          <Card title="Money">
            <dl className="grid gap-1.5 text-sm">
              <div className="flex justify-between">
                <dt className="text-fg-2">Applied</dt>
                <dd className="tnum">{rupees(r.allocated)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-fg-2">On account</dt>
                <dd className="tnum">
                  {Number(r.unallocated) > 0 ? (
                    <Badge tone="warning">{rupees(r.unallocated)}</Badge>
                  ) : (
                    rupees(0)
                  )}
                </dd>
              </div>
              <div className="mt-1 flex justify-between border-t border-border pt-2 text-base font-semibold">
                <dt>{kind === "receipts" ? "Received" : "Paid"}</dt>
                <dd className="tnum">{rupees(r.amount)}</dd>
              </div>
            </dl>
          </Card>
          <Card>
            <DefinitionList
              columns={1}
              items={[
                ...(r.bankName ? [{ label: "Bank", value: r.bankName }] : []),
                ...(r.instrumentDate ? [{ label: "Cheque date", value: r.instrumentDate }] : []),
                { label: "Posted", value: r.postedAt ? dateTime(r.postedAt) : "Not yet" },
                { label: "Notes", value: r.notes ?? "—" },
              ]}
            />
          </Card>
          {Number(r.unallocated) > 0 && r.status === "Posted" ? (
            <Button asChild variant="secondary">
              <Link
                to="/collections/statement/$party/$partyId"
                params={{ party: k.party, partyId: r.partyId }}
              >
                Apply the money on account
              </Link>
            </Button>
          ) : null}
        </div>
      </div>
      <ConfirmDialog
        open={dialog === "post" || dialog === "cancel"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={dialog === "post" ? `Post this ${k.one.toLowerCase()}?` : "Discard this draft?"}
        description={
          dialog === "post"
            ? `${rupees(r.amount)} is recorded and the invoices it is applied to are settled.`
            : undefined
        }
        confirmLabel={dialog === "post" ? "Post" : "Discard"}
        tone={dialog === "cancel" ? "danger" : "primary"}
        busy={act.isPending}
        onConfirm={() =>
          (dialog === "post" || dialog === "cancel") && act.mutate({ action: dialog })
        }
      />
      {dialog === "reverse" ? (
        <ReverseDialog
          busy={act.isPending}
          onClose={() => setDialog(null)}
          onReverse={(kind, reason) => act.mutate({ action: "reverse", kind, reason })}
        />
      ) : null}
    </div>
  );
}

function ReverseDialog({
  busy,
  onClose,
  onReverse,
}: {
  busy: boolean;
  onClose: () => void;
  onReverse: (kind: "BOUNCED" | "MISTAKE", reason: string) => void;
}) {
  const [kind, setKind] = useState<"BOUNCED" | "MISTAKE">("BOUNCED");
  const [reason, setReason] = useState("");
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Reverse this money?"
      description="The invoices it paid owe again, its commission is taken back and the customer's credit is re-checked. The number is not reused."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Back
          </Button>
          <Button
            variant="danger"
            busy={busy}
            disabled={reason.trim().length < 3}
            onClick={() => onReverse(kind, reason.trim())}
          >
            Reverse
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <div className="grid gap-1.5">
          <span className="text-sm font-medium text-fg">What happened</span>
          <Segmented
            label="What happened"
            value={kind}
            onValueChange={setKind}
            options={[
              { value: "BOUNCED", label: "Cheque bounced" },
              { value: "MISTAKE", label: "Entered by mistake" },
            ]}
          />
        </div>
        <Field label="Reason" required>
          {(p) => (
            <TextInput
              {...p}
              autoFocus
              value={reason}
              placeholder="e.g. Returned unpaid: insufficient funds"
              onChange={(e) => setReason(e.target.value)}
            />
          )}
        </Field>
      </div>
    </Dialog>
  );
}
