import type { CreditCheck, EInvoiceInfo, SiDetail } from "@erp/contracts";
import { D } from "@erp/domain";
import {
  Badge,
  Button,
  Card,
  DefinitionList,
  Dialog,
  Field,
  Mono,
  TextInput,
  type Tone,
} from "@erp/ui";
import { Link } from "@tanstack/react-router";
import { AlertTriangle, CheckCircle2, FileDown, ShieldAlert } from "lucide-react";
import { useState } from "react";
import { useApiErrorToast } from "../lib/errors.js";
import { dateTime } from "../lib/format.js";
import {
  CREDIT_REASON_LABEL,
  IRN_TONE,
  STATUS_LABEL,
  openDocumentPdf,
  rupees,
} from "../lib/sales.js";

type Totals = SiDetail["totals"];

/** Title with number + status badge, used by every sales detail page. */
export function DocTitle({
  number,
  draftLabel,
  status,
  tone,
}: {
  number: string | null;
  draftLabel: string;
  status: string;
  tone: Tone;
}) {
  return (
    <span className="flex flex-wrap items-center gap-3">
      {number ? <Mono>{number}</Mono> : draftLabel}
      <Badge tone={tone}>{STATUS_LABEL[status] ?? status}</Badge>
    </span>
  );
}

export const crumbLink = (crumb: { href?: string; label: string }, className: string) => (
  <Link to={crumb.href!} className={className}>
    {crumb.label}
  </Link>
);

/** Taxable, GST split and total, invoice style. */
export function TotalsCard({ totals, title = "Totals" }: { totals: Totals; title?: string }) {
  const igst = totals.regime === "IGST";
  const rows: [string, string, boolean?][] = [
    ["Gross", totals.gross],
    ...(D(totals.discount).isZero()
      ? []
      : [["Discount", `-${totals.discount}`] as [string, string]]),
    ["Taxable value", totals.taxable],
    ...(igst
      ? [["IGST", totals.igst] as [string, string]]
      : [["CGST", totals.cgst] as [string, string], ["SGST", totals.sgst] as [string, string]]),
    ...(D(totals.roundOff).isZero() ? [] : [["Round off", totals.roundOff] as [string, string]]),
  ];
  return (
    <Card title={title}>
      <dl className="grid gap-1.5 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-4">
            <dt className="text-fg-2">{label}</dt>
            <dd className="tnum">{rupees(value)}</dd>
          </div>
        ))}
        <div className="mt-1 flex justify-between gap-4 border-t border-border pt-2 text-base font-semibold">
          <dt>Total</dt>
          <dd className="tnum">{rupees(totals.total)}</dd>
        </div>
      </dl>
      <p className="mt-2 text-xs text-fg-3">
        {igst ? "Inter-state: IGST" : "Intra-state: CGST + SGST"}
      </p>
    </Card>
  );
}

/** The live credit position (ADR-0016: exposure includes this order). */
export function CreditPanel({
  credit,
  title = "Credit check",
}: {
  credit: CreditCheck;
  title?: string;
}) {
  return (
    <Card
      title={title}
      actions={
        credit.blocked ? (
          <Badge tone="danger" dot>
            Blocked
          </Badge>
        ) : (
          <Badge tone="success" dot>
            Within terms
          </Badge>
        )
      }
    >
      {credit.blocked ? (
        <div className="mb-3 flex items-start gap-2 rounded-md bg-danger-soft p-3 text-sm text-danger">
          <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{credit.reasons.map((r) => CREDIT_REASON_LABEL[r]).join(" · ")}</span>
        </div>
      ) : null}
      <DefinitionList
        columns={2}
        items={[
          {
            label: "Outstanding",
            value: <span className="tnum">{rupees(credit.outstanding)}</span>,
          },
          {
            label: "Other open orders",
            value: <span className="tnum">{rupees(credit.otherOpenOrders)}</span>,
          },
          { label: "This order", value: <span className="tnum">{rupees(credit.thisOrder)}</span> },
          {
            label: "Exposure",
            value: <span className="tnum font-semibold">{rupees(credit.exposure)}</span>,
          },
          { label: "Credit limit", value: <span className="tnum">{rupees(credit.limit)}</span> },
          {
            label: "Headroom",
            value: (
              <span className={D(credit.headroom).isNegative() ? "tnum text-danger" : "tnum"}>
                {rupees(credit.headroom)}
              </span>
            ),
          },
          {
            label: "Overdue",
            value:
              credit.overdueInvoices > 0
                ? `${credit.overdueInvoices} invoice${credit.overdueInvoices === 1 ? "" : "s"}, up to ${credit.maxDaysPastDue} days`
                : "None",
          },
          { label: "Checked", value: dateTime(credit.checkedAt) },
        ]}
      />
    </Card>
  );
}

/** IRN status, details and the actions a person can take (ADR-0011). */
export function EInvoiceCard({ info, actions }: { info: EInvoiceInfo; actions?: React.ReactNode }) {
  const tone = IRN_TONE[info.status];
  const [now] = useState(() => Date.now());
  return (
    <Card
      title="E-invoice"
      actions={
        <Badge tone={tone} dot>
          {STATUS_LABEL[info.status] ?? info.status}
        </Badge>
      }
    >
      {info.status === "Generated" ? (
        <DefinitionList
          columns={1}
          items={[
            { label: "IRN", value: <Mono className="break-all text-xs">{info.irn}</Mono> },
            { label: "Ack no.", value: <Mono>{info.ackNo}</Mono> },
            { label: "Ack date", value: dateTime(info.ackDate) },
            ...(info.cancellableUntil && Date.parse(info.cancellableUntil) > now
              ? [{ label: "Can be cancelled until", value: dateTime(info.cancellableUntil) }]
              : []),
          ]}
        />
      ) : info.status === "Pending" ? (
        <p className="flex items-start gap-2 text-sm text-fg-2">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
          {info.lastError
            ? `Retrying automatically (${info.attempts} tries so far). Last error: ${info.lastError}`
            : "Being reported to the e-invoice portal. The final PDF prints once the IRN arrives."}
        </p>
      ) : info.status === "Failed" ? (
        <p className="flex items-start gap-2 text-sm text-danger">
          <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          The portal rejected it: {info.lastError}. Fix the data and retry, or record an IRN made on
          the portal.
        </p>
      ) : info.status === "Cancelled" ? (
        <p className="text-sm text-fg-2">The IRN was cancelled on the portal.</p>
      ) : (
        <p className="flex items-center gap-2 text-sm text-fg-2">
          <CheckCircle2 className="size-4 text-success" aria-hidden />
          No IRN needed (unregistered buyer, or not posted).
        </p>
      )}
      {actions ? <div className="mt-3 flex flex-wrap gap-2">{actions}</div> : null}
    </Card>
  );
}

export function PdfButton({
  kind,
  id,
  label = "PDF",
}: {
  kind: Parameters<typeof openDocumentPdf>[0];
  id: string;
  label?: string;
}) {
  const [busy, setBusy] = useState(false);
  const onError = useApiErrorToast();
  return (
    <Button
      variant="secondary"
      icon={FileDown}
      busy={busy}
      onClick={() => {
        setBusy(true);
        openDocumentPdf(kind, id)
          .catch((e: unknown) => onError(e))
          .finally(() => setBusy(false));
      }}
    >
      {label}
    </Button>
  );
}

/** Asks for the reason an audited action needs (X-Change-Reason), then runs it. */
export function ReasonDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  tone = "primary",
  busy,
  onConfirm,
  placeholder = "Why? Saved in the audit log.",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: React.ReactNode;
  confirmLabel: string;
  tone?: "primary" | "danger";
  busy?: boolean;
  onConfirm: (reason: string) => void;
  placeholder?: string;
}) {
  const [reason, setReason] = useState("");
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setReason("");
        onOpenChange(o);
      }}
      title={title}
      description={description}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Back
          </Button>
          <Button
            variant={tone === "danger" ? "danger" : "primary"}
            busy={busy}
            disabled={reason.trim().length < 3}
            onClick={() => onConfirm(reason.trim())}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <Field label="Reason" required>
        {(p) => (
          <TextInput
            {...p}
            autoFocus
            maxLength={300}
            placeholder={placeholder}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        )}
      </Field>
    </Dialog>
  );
}
