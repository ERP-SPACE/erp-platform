import type {
  CashAccount,
  OpeningBatch,
  OpeningBatchKind,
  OpeningChapter,
  OpeningChapterCode,
  OpeningCheckReport,
  OpeningStatus,
} from "@erp/contracts";
import { D, formatINRCompact } from "@erp/domain";
import {
  Badge,
  Button,
  Card,
  DataTable,
  Dialog,
  EmptyState,
  Field,
  Mono,
  Segmented,
  Select,
  TextInput,
  type Tone,
  useToast,
} from "@erp/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileUp,
  Lock,
  Pencil,
  Plus,
  ShieldCheck,
  Trash2,
  Upload,
} from "lucide-react";
import { type ChangeEvent, useRef, useState } from "react";
import { z } from "zod";
import { useApiErrorToast } from "../../../lib/errors.js";
import { dateTime } from "../../../lib/format.js";
import {
  CHAPTER_LABEL,
  type CashInput,
  addCash,
  chapterNotNeeded,
  confirmCash,
  confirmChapter,
  discardBatch,
  goLive,
  normaliseAmount,
  openingKeys,
  openingQuery,
  removeCash,
  templateUrl,
  updateCash,
  uploadOpening,
} from "../../../lib/opening.js";
import { can, meQuery } from "../../../lib/queries.js";
import { rupees } from "../../../lib/sales.js";

const STEPS = ["STOCK", "AR", "AP", "CASH", "REVIEW", "GOLIVE"] as const;
type Step = (typeof STEPS)[number];
const STEP_LABEL: Record<Step, string> = { ...CHAPTER_LABEL, REVIEW: "Review", GOLIVE: "Go live" };

export const Route = createFileRoute("/_app/settings/opening")({
  validateSearch: z.object({ step: z.enum(STEPS).optional() }),
  component: OpeningPage,
});

const STATUS_TONE: Record<OpeningChapter["status"], Tone> = {
  Empty: "neutral",
  Draft: "warning",
  Confirmed: "success",
  NotNeeded: "info",
};
const STATUS_LABEL: Record<OpeningChapter["status"], string> = {
  Empty: "Not started",
  Draft: "To confirm",
  Confirmed: "Confirmed",
  NotNeeded: "Not needed",
};

/**
 * Opening Balance Wizard (PRD §5.10, brief §B4.10): Stock → Receivables → Payables → Bank &
 * cash → Review → Go live. Each upload is checked before anything is saved; each chapter is
 * confirmed against the old books to the paisa; after go-live everything here is read-only.
 */
function OpeningPage() {
  const { step = "STOCK" } = Route.useSearch();
  const navigate = Route.useNavigate();
  const { data: s } = useQuery(openingQuery);
  if (!s) return null;
  const locked = Boolean(s.lockedAt);
  const chapter = (c: OpeningChapterCode) => s.chapters.find((x) => x.chapter === c)!;
  const done = s.chapters.filter(
    (c) => c.status === "Confirmed" || c.status === "NotNeeded",
  ).length;
  return (
    <div className="grid gap-6">
      <Card
        title="Opening balances"
        description={
          s.goLiveDate
            ? `Go-live ${s.goLiveDate}; opening balances are dated ${s.openingDate}.`
            : "Bring stock, receivables, payables and bank balances over from the old books before going live."
        }
        actions={
          locked ? (
            <Badge tone="success">
              <Lock className="size-3" aria-hidden /> Live since {dateTime(s.lockedAt)}
            </Badge>
          ) : (
            <Badge tone="warning">Not live yet</Badge>
          )
        }
      >
        <div className="grid gap-4">
          <p className="text-sm text-fg-2">
            {done} of 4 chapters settled. Work through them in any order; each import is checked
            before anything is saved, and confirmed against your books to the paisa.
          </p>
          {!s.goLiveDate ? (
            <Callout tone="warning">
              Set the go-live date first in{" "}
              <Link to="/settings/general" className="font-medium text-primary hover:underline">
                Settings → General → Go-live
              </Link>
              . Opening balances are dated the day before it.
            </Callout>
          ) : null}
          {locked ? (
            <Callout tone="info">
              Went live {dateTime(s.lockedAt)}
              {s.lockedBy === "manual"
                ? ` (by ${s.lockedByName ?? "the Owner"})`
                : ` with the first live posting, ${s.lockedBy}`}
              . Opening balances are now read-only; correct them with a note or a stock adjustment
              and a reason.
            </Callout>
          ) : null}
        </div>
      </Card>

      <nav aria-label="Opening balance chapters" className="-mt-2 border-b border-border">
        <ul className="flex gap-1 overflow-x-auto">
          {STEPS.map((x) => {
            const on = x === step;
            const st = x === "REVIEW" || x === "GOLIVE" ? null : chapter(x).status;
            return (
              <li key={x}>
                <button
                  type="button"
                  aria-current={on ? "page" : undefined}
                  onClick={() => void navigate({ search: { step: x } })}
                  className={`-mb-px flex h-10 items-center gap-2 whitespace-nowrap border-b-2 px-3 text-sm font-medium ${
                    on
                      ? "border-primary text-primary"
                      : "border-transparent text-fg-2 hover:text-fg"
                  }`}
                >
                  {STEP_LABEL[x]}
                  {st ? (
                    <Badge tone={STATUS_TONE[st]} dot={false}>
                      {STATUS_LABEL[st]}
                    </Badge>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      {step === "STOCK" ? <StockChapter s={s} locked={locked} /> : null}
      {step === "AR" ? <LedgerChapter s={s} kind="AR" locked={locked} /> : null}
      {step === "AP" ? <LedgerChapter s={s} kind="AP" locked={locked} /> : null}
      {step === "CASH" ? <CashChapter s={s} locked={locked} /> : null}
      {step === "REVIEW" ? <Review s={s} /> : null}
      {step === "GOLIVE" ? <GoLive s={s} /> : null}
    </div>
  );
}

function Callout({
  tone,
  children,
}: {
  tone: "warning" | "info" | "danger";
  children: React.ReactNode;
}) {
  const cls = {
    warning: "border-warning/30 bg-warning-soft text-fg",
    info: "border-info/30 bg-info-soft text-fg",
    danger: "border-danger/30 bg-danger-soft text-fg",
  }[tone];
  return <div className={`rounded-md border px-4 py-3 text-sm ${cls}`}>{children}</div>;
}

// ── stock / receivables / payables ───────────────────────────────────────────

function StockChapter({ s, locked }: { s: OpeningStatus; locked: boolean }) {
  const [kind, setKind] = useState<"STOCK_ROLLS" | "STOCK_SKU">("STOCK_ROLLS");
  const ch = s.chapters.find((c) => c.chapter === "STOCK")!;
  return (
    <div className="grid gap-6">
      {!locked ? (
        <Card
          title="Import opening stock"
          description="Roll by roll if you have a roll list (barcodes kept when valid), or totals per SKU, which become 1,000 m rolls with new labels."
          actions={
            <Segmented
              label="How the stock is listed"
              value={kind}
              onValueChange={setKind}
              options={[
                { value: "STOCK_ROLLS", label: "Roll by roll" },
                { value: "STOCK_SKU", label: "Totals per SKU" },
              ]}
            />
          }
        >
          <UploadPanel key={kind} kind={kind} disabled={!s.goLiveDate} />
        </Card>
      ) : null}
      <Batches chapter={ch} />
      <ConfirmPanel chapter={ch} locked={locked} what="inventory value" />
    </div>
  );
}

function LedgerChapter({
  s,
  kind,
  locked,
}: {
  s: OpeningStatus;
  kind: "AR" | "AP";
  locked: boolean;
}) {
  const ch = s.chapters.find((c) => c.chapter === kind)!;
  return (
    <div className="grid gap-6">
      {!locked ? (
        <Card
          title={kind === "AR" ? "Import opening receivables" : "Import opening payables"}
          description={
            kind === "AR"
              ? "One row per unpaid invoice: customer (code, GSTIN or exact name), your invoice number, date, amount still due, due date. They keep your old numbers."
              : "One row per unpaid supplier bill: supplier, their invoice number, date, amount still due."
          }
        >
          <UploadPanel kind={kind} disabled={!s.goLiveDate} />
        </Card>
      ) : null}
      <Batches chapter={ch} />
      <ConfirmPanel
        chapter={ch}
        locked={locked}
        what={kind === "AR" ? "debtors (sundry debtors)" : "creditors (sundry creditors)"}
      />
    </div>
  );
}

function UploadPanel({ kind, disabled }: { kind: OpeningBatchKind; disabled: boolean }) {
  const [file, setFile] = useState<{ name: string; csv: string } | null>(null);
  const [report, setReport] = useState<OpeningCheckReport | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const onError = useApiErrorToast();
  const queryClient = useQueryClient();
  const check = useMutation({
    mutationFn: (f: { name: string; csv: string }) =>
      uploadOpening({ kind, fileName: f.name, csv: f.csv, dryRun: true }),
    onSuccess: setReport,
    onError: (e) => onError(e),
  });
  const save = useMutation({
    mutationFn: () => uploadOpening({ kind, fileName: file!.name, csv: file!.csv, dryRun: false }),
    onSuccess: async (r) => {
      if (r.batchId) {
        toast({
          tone: "success",
          title: `Imported ${r.okCount.toLocaleString("en-IN")} rows`,
          description: `Total ${rupees(r.total)}`,
        });
        setFile(null);
        setReport(null);
        if (input.current) input.current.value = "";
      } else setReport(r);
      await queryClient.invalidateQueries({ queryKey: openingKeys.all });
    },
    onError: (e) => onError(e, openingKeys.all),
  });
  const pick = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const next = { name: f.name, csv: await f.text() };
    setFile(next);
    setReport(null);
    check.mutate(next);
  };
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <input
          ref={input}
          id={`file-${kind}`}
          aria-label="CSV file to check"
          type="file"
          accept=".csv,text/csv"
          className="sr-only"
          onChange={(e) => void pick(e)}
          disabled={disabled}
        />
        <Button
          variant="primary"
          icon={FileUp}
          disabled={disabled}
          busy={check.isPending}
          onClick={() => input.current?.click()}
        >
          {file ? "Choose another file" : "Choose CSV file"}
        </Button>
        <Button asChild variant="secondary" icon={Download}>
          <a href={templateUrl(kind)} download>
            Download template
          </a>
        </Button>
        {file ? <span className="text-sm text-fg-2">{file.name}</span> : null}
      </div>
      {report ? <CheckReport report={report} /> : null}
      {report && !report.errors.length && report.okCount ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="primary"
            icon={Upload}
            busy={save.isPending}
            onClick={() => save.mutate()}
          >
            Import {report.okCount.toLocaleString("en-IN")} rows · {rupees(report.total)}
          </Button>
          <span className="text-xs text-fg-2">
            Nothing is saved until you press Import. You can discard an import until go-live.
          </span>
        </div>
      ) : null}
    </div>
  );
}

function CheckReport({ report }: { report: OpeningCheckReport }) {
  const stats = [
    { label: "Rows in file", value: report.rowCount.toLocaleString("en-IN") },
    { label: "Ready to import", value: report.okCount.toLocaleString("en-IN") },
    {
      label: "Errors",
      value: report.errors.length.toLocaleString("en-IN"),
      tone: report.errors.length ? "text-danger" : "",
    },
    {
      label: "Warnings",
      value: report.warnings.length.toLocaleString("en-IN"),
      tone: report.warnings.length ? "text-warning" : "",
    },
    {
      label: report.kind.startsWith("STOCK") ? "Stock value" : "Amount due",
      value: rupees(report.total),
    },
    ...(report.metres !== null
      ? [{ label: "Metres", value: `${report.metres.toLocaleString("en-IN")} m` }]
      : []),
    ...(report.rolls !== null
      ? [{ label: "Rolls", value: report.rolls.toLocaleString("en-IN") }]
      : []),
  ];
  const previewKeys = Object.keys(report.preview[0] ?? {});
  const MONEY = new Set(["amount", "value"]);
  const previewColumns: ColumnDef<Record<string, unknown>, unknown>[] = previewKeys.map((k) => ({
    accessorKey: k,
    header:
      k === "costPerM"
        ? "Cost ₹/m"
        : k.replace(/([A-Z])/g, " $1").replace(/^./, (x) => x.toUpperCase()),
    meta: MONEY.has(k) || k === "metres" || k === "costPerM" ? { numeric: true } : undefined,
    cell: (c) => {
      const v = c.getValue();
      if (v === null || v === undefined || v === "") return "—";
      if (MONEY.has(k)) return rupees(String(v));
      if (k === "costPerM") return rupees(String(v));
      if (k === "metres") return `${Number(v).toLocaleString("en-IN")} m`;
      return String(v);
    },
  }));
  return (
    <div className="grid gap-4">
      <dl className="flex flex-wrap gap-x-8 gap-y-3 rounded-md border border-border bg-muted/40 px-4 py-3 text-sm">
        {stats.map((x) => (
          <div key={x.label} className="grid gap-0.5">
            <dt className="text-xs text-fg-2">{x.label}</dt>
            <dd className={`tnum font-semibold ${x.tone ?? "text-fg"}`}>{x.value}</dd>
          </div>
        ))}
      </dl>
      {report.errors.length ? (
        <IssueList
          tone="danger"
          title="Fix these in the file and choose it again — nothing has been saved"
          issues={report.errors}
        />
      ) : null}
      {report.warnings.length ? (
        <IssueList
          tone="warning"
          title="Worth a look (they don't stop the import)"
          issues={report.warnings}
        />
      ) : null}
      {report.preview.length ? (
        <div className="grid gap-2">
          <p className="text-sm text-fg-2">
            First {report.preview.length.toLocaleString("en-IN")} rows as they will be saved:
          </p>
          <DataTable
            caption="Preview"
            data={report.preview}
            columns={previewColumns}
            getRowId={(_r) => JSON.stringify(_r)}
            pageSize={10}
          />
        </div>
      ) : null}
    </div>
  );
}

/** Line-numbered problems from the check, first 50 shown. */
function IssueList({
  tone,
  title,
  issues,
}: {
  tone: "danger" | "warning";
  title: string;
  issues: OpeningCheckReport["errors"];
}) {
  const shown = issues.slice(0, 50);
  return (
    <section aria-label={title} className="grid gap-2">
      <h3
        className={`flex items-center gap-2 text-sm font-medium ${tone === "danger" ? "text-danger" : "text-warning"}`}
      >
        <AlertTriangle className="size-4" aria-hidden /> {title}
      </h3>
      <ul className="divide-y divide-border rounded-md border border-border text-sm">
        {shown.map((i) => (
          <li key={`${i.line}-${i.column}-${i.message}`} className="flex gap-3 px-3 py-2">
            <Mono className="w-16 shrink-0 text-fg-2">Line {i.line}</Mono>
            {i.column ? <Mono className="w-28 shrink-0 text-fg-2">{i.column}</Mono> : null}
            <span className="text-fg">{i.message}</span>
          </li>
        ))}
      </ul>
      {issues.length > shown.length ? (
        <p className="text-xs text-fg-2">
          …and {(issues.length - shown.length).toLocaleString("en-IN")} more.
        </p>
      ) : null}
    </section>
  );
}

function Batches({ chapter }: { chapter: OpeningChapter }) {
  const [discarding, setDiscarding] = useState<OpeningBatch | null>(null);
  const columns: ColumnDef<OpeningBatch, unknown>[] = [
    {
      accessorKey: "fileName",
      header: "File",
      cell: (c) => <span className="font-medium">{c.getValue() as string}</span>,
    },
    {
      accessorKey: "kind",
      header: "Kind",
      cell: (c) =>
        ({ STOCK_ROLLS: "Roll by roll", STOCK_SKU: "Per SKU", AR: "Receivables", AP: "Payables" })[
          c.getValue() as OpeningBatchKind
        ],
    },
    {
      accessorKey: "rowCount",
      header: "Rows",
      meta: { numeric: true },
      cell: (c) => (c.getValue() as number).toLocaleString("en-IN"),
    },
    {
      accessorKey: "total",
      header: "Total",
      meta: { numeric: true },
      cell: (c) => rupees(c.getValue() as string),
    },
    {
      id: "docs",
      header: "Documents",
      cell: ({ row }) =>
        row.original.documents.length ? (
          <span className="flex flex-wrap gap-1.5">
            {row.original.documents.map((d) => (
              <Link
                key={d.id}
                to="/purchase/receipts/$grnId"
                params={{ grnId: d.id }}
                className="text-primary hover:underline"
              >
                <Mono>{d.docNo}</Mono>
              </Link>
            ))}
          </span>
        ) : (
          "—"
        ),
    },
    {
      id: "by",
      header: "Imported",
      cell: ({ row }) =>
        `${row.original.createdByName ?? "—"} · ${dateTime(row.original.createdAt)}`,
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) =>
        row.original.status === "Discarded" ? (
          <span title={row.original.discardReason ?? undefined}>
            <Badge tone="neutral">Discarded</Badge>
          </span>
        ) : (
          <Badge tone="success">Imported</Badge>
        ),
    },
    {
      id: "actions",
      header: "",
      enableSorting: false,
      cell: ({ row }) =>
        row.original.discardable ? (
          <Button
            size="sm"
            variant="ghost"
            icon={Trash2}
            onClick={() => setDiscarding(row.original)}
          >
            Discard
          </Button>
        ) : null,
    },
  ];
  if (!chapter.batches.length) return null;
  return (
    <>
      <Card title="Imports" padded={false}>
        <DataTable
          caption={`${CHAPTER_LABEL[chapter.chapter]} imports`}
          data={chapter.batches}
          columns={columns}
          getRowId={(b) => b.id}
          pageSize={false}
        />
      </Card>
      {discarding ? <DiscardDialog batch={discarding} onClose={() => setDiscarding(null)} /> : null}
    </>
  );
}

function DiscardDialog({ batch, onClose }: { batch: OpeningBatch; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const toast = useToast();
  const onError = useApiErrorToast();
  const queryClient = useQueryClient();
  const go = useMutation({
    mutationFn: () => discardBatch(batch.id, reason.trim()),
    onSuccess: async () => {
      toast({ tone: "success", title: `Discarded ${batch.fileName}` });
      await queryClient.invalidateQueries({ queryKey: openingKeys.all });
      onClose();
    },
    onError: (e) => onError(e, openingKeys.all),
  });
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Discard this import?"
      description={`Everything ${batch.fileName} created is removed (${rupees(batch.total)}). The chapter will need confirming again.`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Keep it
          </Button>
          <Button
            variant="danger"
            busy={go.isPending}
            disabled={reason.trim().length < 3}
            onClick={() => go.mutate()}
          >
            Discard
          </Button>
        </>
      }
    >
      <Field label="Reason" required>
        {(p) => (
          <TextInput
            {...p}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. wrong file, amounts in lakhs"
          />
        )}
      </Field>
    </Dialog>
  );
}

function ConfirmPanel({
  chapter,
  locked,
  what,
}: {
  chapter: OpeningChapter;
  locked: boolean;
  what: string;
}) {
  const [books, setBooks] = useState("");
  const [notNeeded, setNotNeeded] = useState(false);
  const onError = useApiErrorToast();
  const toast = useToast();
  const queryClient = useQueryClient();
  const amount = normaliseAmount(books);
  const confirm = useMutation({
    mutationFn: () => confirmChapter(chapter.chapter, amount!),
    onSuccess: async () => {
      toast({
        tone: "success",
        title: `${CHAPTER_LABEL[chapter.chapter]} confirmed against the books`,
      });
      setBooks("");
      await queryClient.invalidateQueries({ queryKey: openingKeys.all });
    },
    onError: (e) => onError(e),
  });
  if (chapter.status === "Confirmed") {
    return (
      <Card>
        <p className="flex items-center gap-2 text-sm">
          <CheckCircle2 className="size-4 text-success" aria-hidden />
          Confirmed: {rupees(chapter.total)} matches the books ({chapter.confirmedByName ?? "—"},{" "}
          {dateTime(chapter.confirmedAt)}).
        </p>
      </Card>
    );
  }
  if (chapter.status === "NotNeeded") {
    return (
      <Card>
        <p className="text-sm text-fg-2">Marked as not needed: {chapter.notNeededReason}</p>
      </Card>
    );
  }
  if (locked) return null;
  const empty = chapter.total === "0.00";
  return (
    <Card
      title="Confirm against the books"
      description={`Enter the ${what} from your old books on ${"the opening date"}. It must equal what was imported to the paisa.`}
    >
      <div className="flex flex-wrap items-end gap-4">
        <div className="grid gap-0.5">
          <span className="text-xs text-fg-2">Imported</span>
          <span className="tnum text-lg font-semibold text-fg">{rupees(chapter.total)}</span>
        </div>
        <Field
          label="Total in your books (₹)"
          error={books && !amount ? "Enter an amount like 1,23,456.50" : undefined}
        >
          {(p) => (
            <TextInput
              {...p}
              inputMode="decimal"
              value={books}
              onChange={(e) => setBooks(e.target.value)}
              placeholder="0.00"
            />
          )}
        </Field>
        <Button
          variant="primary"
          icon={ShieldCheck}
          disabled={!amount || (empty && chapter.chapter !== "CASH")}
          busy={confirm.isPending}
          onClick={() => confirm.mutate()}
        >
          Confirm
        </Button>
        {amount && !empty ? (
          <span className={`text-sm ${amount === chapter.total ? "text-success" : "text-danger"}`}>
            {amount === chapter.total
              ? "Matches"
              : `Difference ${rupees(D(chapter.total).minus(amount).toFixed(2))}`}
          </span>
        ) : null}
        {empty ? (
          <Button variant="ghost" onClick={() => setNotNeeded(true)}>
            Not needed
          </Button>
        ) : null}
      </div>
      {notNeeded ? (
        <NotNeededDialog chapter={chapter.chapter} onClose={() => setNotNeeded(false)} />
      ) : null}
    </Card>
  );
}

function NotNeededDialog({
  chapter,
  onClose,
}: {
  chapter: OpeningChapterCode;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  const onError = useApiErrorToast();
  const queryClient = useQueryClient();
  const go = useMutation({
    mutationFn: () => chapterNotNeeded(chapter, reason.trim()),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: openingKeys.all });
      onClose();
    },
    onError: (e) => onError(e),
  });
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`${CHAPTER_LABEL[chapter]}: not needed?`}
      description="Say why, for the record (e.g. no unpaid supplier bills at the cut-over)."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            busy={go.isPending}
            disabled={reason.trim().length < 3}
            onClick={() => go.mutate()}
          >
            Mark not needed
          </Button>
        </>
      }
    >
      <Field label="Reason" required>
        {(p) => <TextInput {...p} value={reason} onChange={(e) => setReason(e.target.value)} />}
      </Field>
    </Dialog>
  );
}

// ── bank and cash ────────────────────────────────────────────────────────────

function CashChapter({ s, locked }: { s: OpeningStatus; locked: boolean }) {
  const [editing, setEditing] = useState<CashAccount | "new" | null>(null);
  const onError = useApiErrorToast();
  const toast = useToast();
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: openingKeys.all });
  const confirm = useMutation({
    mutationFn: (a: CashAccount) => confirmCash(a.id, a.version),
    onSuccess: async () => {
      toast({ tone: "success", title: "Balance confirmed" });
      await refresh();
    },
    onError: (e) => onError(e, openingKeys.all),
  });
  const remove = useMutation({
    mutationFn: (a: CashAccount) => removeCash(a.id),
    onSuccess: refresh,
    onError: (e) => onError(e),
  });
  const columns: ColumnDef<CashAccount, unknown>[] = [
    {
      accessorKey: "name",
      header: "Account",
      cell: (c) => <span className="font-medium">{c.getValue() as string}</span>,
    },
    {
      id: "bank",
      header: "Bank",
      cell: ({ row }) =>
        row.original.kind === "CASH"
          ? "Cash"
          : `${row.original.bankName ?? ""}${row.original.accountLast4 ? ` ··${row.original.accountLast4}` : ""}`,
    },
    { accessorKey: "asOf", header: "As of" },
    {
      accessorKey: "balance",
      header: "Balance",
      meta: { numeric: true },
      cell: (c) => {
        const v = c.getValue() as string;
        return v.startsWith("-") ? (
          <span className="text-danger">({rupees(v.slice(1))}) overdrawn</span>
        ) : (
          rupees(v)
        );
      },
    },
    {
      id: "confirmed",
      header: "Confirmed",
      cell: ({ row }) =>
        row.original.confirmedAt ? (
          <Badge tone="success">{row.original.confirmedByName ?? "Yes"}</Badge>
        ) : locked ? (
          "—"
        ) : (
          <Button
            size="sm"
            variant="secondary"
            icon={ShieldCheck}
            busy={confirm.isPending}
            onClick={() => confirm.mutate(row.original)}
          >
            Confirm
          </Button>
        ),
    },
    {
      id: "actions",
      header: "",
      enableSorting: false,
      cell: ({ row }) =>
        locked ? null : (
          <span className="flex gap-1">
            <Button
              size="sm"
              variant="ghost"
              icon={Pencil}
              aria-label={`Edit ${row.original.name}`}
              onClick={() => setEditing(row.original)}
            />
            <Button
              size="sm"
              variant="ghost"
              icon={Trash2}
              aria-label={`Remove ${row.original.name}`}
              onClick={() => remove.mutate(row.original)}
            />
          </span>
        ),
    },
  ];
  const ch = s.chapters.find((c) => c.chapter === "CASH")!;
  return (
    <div className="grid gap-6">
      <Card
        title="Bank and cash balances"
        description="One line per bank account and cash box, as on the opening date. The accountant confirms each with their password. These are kept for the accounting stage; nothing is posted."
        padded={false}
        actions={
          locked ? null : (
            <Button variant="primary" icon={Plus} onClick={() => setEditing("new")}>
              Add account
            </Button>
          )
        }
      >
        <DataTable
          caption="Bank and cash balances"
          data={s.cash}
          columns={columns}
          getRowId={(a) => a.id}
          pageSize={false}
          empty={
            <EmptyState
              icon={Plus}
              title="No accounts yet"
              hint="Add each bank account and cash box."
            />
          }
        />
      </Card>
      <ConfirmPanel chapter={ch} locked={locked} what="total of bank and cash balances" />
      {editing ? (
        <CashDialog
          account={editing === "new" ? null : editing}
          openingDate={s.openingDate}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}

function CashDialog({
  account,
  openingDate,
  onClose,
}: {
  account: CashAccount | null;
  openingDate: string | null;
  onClose: () => void;
}) {
  const [form, setForm] = useState<CashInput>({
    name: account?.name ?? "",
    kind: account?.kind ?? "BANK",
    bankName: account?.bankName ?? "",
    accountLast4: account?.accountLast4 ?? "",
    balance: account?.balance ?? "",
    asOf: account?.asOf ?? openingDate ?? "",
  });
  const onError = useApiErrorToast();
  const queryClient = useQueryClient();
  const amount = normaliseAmount(form.balance);
  const save = useMutation({
    mutationFn: () => {
      const body = {
        ...form,
        balance: amount!,
        bankName: form.kind === "BANK" ? form.bankName || null : null,
        accountLast4: form.accountLast4 || null,
      };
      return account
        ? updateCash(account.id, { ...body, version: account.version })
        : addCash(body);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: openingKeys.all });
      onClose();
    },
    onError: (e) => onError(e, openingKeys.all),
  });
  const set = (k: keyof CashInput) => (e: ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={account ? `Edit ${account.name}` : "Add bank or cash account"}
      description={account?.confirmedAt ? "Changing it clears the confirmation." : undefined}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            busy={save.isPending}
            disabled={!form.name.trim() || !amount || !form.asOf}
            onClick={() => save.mutate()}
          >
            Save
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" required className="sm:col-span-2">
          {(p) => (
            <TextInput
              {...p}
              value={form.name}
              onChange={set("name")}
              placeholder="e.g. HDFC current account"
            />
          )}
        </Field>
        <Field label="Kind" required>
          {(p) => (
            <Select
              id={p.id}
              value={form.kind}
              onValueChange={(v) => setForm((f) => ({ ...f, kind: v as "BANK" | "CASH" }))}
              options={[
                { value: "BANK", label: "Bank account" },
                { value: "CASH", label: "Cash" },
              ]}
            />
          )}
        </Field>
        <Field label="As of" required>
          {(p) => <TextInput {...p} type="date" value={form.asOf} onChange={set("asOf")} />}
        </Field>
        {form.kind === "BANK" ? (
          <>
            <Field label="Bank" required>
              {(p) => <TextInput {...p} value={form.bankName ?? ""} onChange={set("bankName")} />}
            </Field>
            <Field label="Last 4 digits" hint="Optional">
              {(p) => (
                <TextInput
                  {...p}
                  inputMode="numeric"
                  maxLength={4}
                  value={form.accountLast4 ?? ""}
                  onChange={set("accountLast4")}
                />
              )}
            </Field>
          </>
        ) : null}
        <Field
          label="Balance (₹)"
          required
          hint="Overdrawn: enter it negative"
          error={form.balance && !amount ? "Enter an amount like 1,250.50" : undefined}
          className="sm:col-span-2"
        >
          {(p) => (
            <TextInput {...p} inputMode="decimal" value={form.balance} onChange={set("balance")} />
          )}
        </Field>
      </div>
    </Dialog>
  );
}

// ── review and go live ───────────────────────────────────────────────────────

function Review({ s }: { s: OpeningStatus }) {
  const columns: ColumnDef<OpeningChapter, unknown>[] = [
    {
      accessorKey: "chapter",
      header: "Chapter",
      cell: (c) => (
        <span className="font-medium">{CHAPTER_LABEL[c.getValue() as OpeningChapterCode]}</span>
      ),
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: (c) => (
        <Badge tone={STATUS_TONE[c.getValue() as OpeningChapter["status"]]}>
          {STATUS_LABEL[c.getValue() as OpeningChapter["status"]]}
        </Badge>
      ),
    },
    {
      accessorKey: "total",
      header: "Imported",
      meta: { numeric: true },
      cell: (c) => rupees(c.getValue() as string),
    },
    {
      accessorKey: "booksTotal",
      header: "Books",
      meta: { numeric: true },
      cell: (c) => ((c.getValue() as string | null) ? rupees(c.getValue() as string) : "—"),
    },
    {
      accessorKey: "difference",
      header: "Difference",
      meta: { numeric: true },
      cell: (c) => {
        const v = c.getValue() as string | null;
        return v === null ? (
          "—"
        ) : v === "0.00" ? (
          <span className="text-success">Nil</span>
        ) : (
          <span className="text-danger">{rupees(v)}</span>
        );
      },
    },
    {
      id: "who",
      header: "Confirmed by",
      cell: ({ row }) =>
        row.original.confirmedAt
          ? `${row.original.confirmedByName ?? "—"} · ${dateTime(row.original.confirmedAt)}`
          : (row.original.notNeededReason ?? "—"),
    },
    {
      id: "imports",
      header: "Imports",
      meta: { numeric: true },
      cell: ({ row }) => row.original.batches.filter((b) => b.status === "Imported").length,
    },
  ];
  const stock = s.chapters.find((c) => c.chapter === "STOCK")!;
  const ar = s.chapters.find((c) => c.chapter === "AR")!;
  return (
    <div className="grid gap-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <p className="text-xs text-fg-2">Opening stock</p>
          <p className="tnum text-2xl font-semibold text-fg">{formatINRCompact(stock.total)}</p>
        </Card>
        <Card>
          <p className="text-xs text-fg-2">Owed by customers</p>
          <p className="tnum text-2xl font-semibold text-fg">{formatINRCompact(ar.total)}</p>
        </Card>
        <Card>
          <p className="text-xs text-fg-2">Owed to suppliers</p>
          <p className="tnum text-2xl font-semibold text-fg">
            {formatINRCompact(s.chapters.find((c) => c.chapter === "AP")!.total)}
          </p>
        </Card>
      </div>
      <Card title="Every chapter against the books" padded={false}>
        <DataTable
          caption="Opening balances review"
          data={s.chapters}
          columns={columns}
          getRowId={(c) => c.chapter}
          pageSize={false}
        />
      </Card>
    </div>
  );
}

function GoLive({ s }: { s: OpeningStatus }) {
  const { data: me } = useQuery(meQuery);
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const toast = useToast();
  const onError = useApiErrorToast();
  const queryClient = useQueryClient();
  const go = useMutation({
    mutationFn: goLive,
    onSuccess: async () => {
      toast({
        tone: "success",
        title: "You are live",
        description: "Opening balances are locked.",
      });
      await queryClient.invalidateQueries({ queryKey: openingKeys.all });
      setOpen(false);
    },
    onError: (e) => onError(e, openingKeys.all),
  });
  if (s.lockedAt) {
    return (
      <Card>
        <EmptyState
          icon={Lock}
          title="Live"
          hint={`Locked ${dateTime(s.lockedAt)}${s.lockedBy === "manual" ? ` by ${s.lockedByName ?? "the Owner"}` : ` by ${s.lockedBy}`}.`}
        />
      </Card>
    );
  }
  return (
    <Card
      title="Go live"
      description="Locks the opening balances for good. It also happens by itself with the first live document (GRN, invoice, note, receipt or payment) dated on or after the go-live date."
    >
      <div className="grid gap-4">
        {s.blockers.length ? (
          <ul className="grid gap-2 text-sm">
            {s.blockers.map((b) => (
              <li key={b} className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden /> {b}
              </li>
            ))}
          </ul>
        ) : (
          <p className="flex items-center gap-2 text-sm text-success">
            <CheckCircle2 className="size-4" aria-hidden /> Every chapter is confirmed or marked not
            needed.
          </p>
        )}
        {can(me, "golive.lock") ? (
          <div>
            <Button
              variant="primary"
              icon={Lock}
              disabled={s.blockers.length > 0}
              onClick={() => setOpen(true)}
            >
              Go live
            </Button>
          </div>
        ) : (
          <p className="text-sm text-fg-2">Only the Owner can go live.</p>
        )}
      </div>
      {open ? (
        <Dialog
          open
          onOpenChange={(o) => !o && setOpen(false)}
          title="Go live?"
          description="Opening stock, receivables, payables and bank balances become read-only. This can't be undone from the app."
          footer={
            <>
              <Button variant="secondary" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                icon={Lock}
                busy={go.isPending}
                disabled={typed !== "GO LIVE"}
                onClick={() => go.mutate()}
              >
                Go live
              </Button>
            </>
          }
        >
          <Field label="Type GO LIVE to confirm" required>
            {(p) => (
              <TextInput
                {...p}
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                autoComplete="off"
              />
            )}
          </Field>
        </Dialog>
      ) : null}
    </Card>
  );
}
