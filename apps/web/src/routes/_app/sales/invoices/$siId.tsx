import type { EInvoiceInfo, EwayBillResult, SiDetail } from "@erp/contracts";
import { D } from "@erp/domain";
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  DataTable,
  DefinitionList,
  Dialog,
  DropdownMenu,
  Drawer,
  Field,
  Mono,
  NumberInput,
  PageHeader,
  TextArea,
  TextInput,
  useToast,
} from "@erp/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import {
  AlertTriangle,
  CheckCircle2,
  FileMinus2,
  MoreHorizontal,
  RefreshCw,
  SlidersHorizontal,
  Truck,
  Undo2,
  XCircle,
} from "lucide-react";
import { useState } from "react";
import {
  DocTitle,
  EInvoiceCard,
  PdfButton,
  ReasonDialog,
  TotalsCard,
  crumbLink,
} from "../../../../components/sales-bits.js";
import { ApiError, api, call, reasonHeader } from "../../../../lib/api.js";
import { useApiErrorToast } from "../../../../lib/errors.js";
import { dateTime } from "../../../../lib/format.js";
import { nullable, settingValue } from "../../../../lib/masters.js";
import { can, keys, meQuery, settingsQuery } from "../../../../lib/queries.js";
import {
  DOC_TONE,
  docAction,
  irnRequestsQuery,
  metres,
  siQuery,
  rupees,
  placeOfSupply,
} from "../../../../lib/sales.js";

export const Route = createFileRoute("/_app/sales/invoices/$siId")({ component: SiPage });

type Line = SiDetail["lines"][number];
const lineColumns: ColumnDef<Line, unknown>[] = [
  {
    accessorKey: "description",
    header: "Item",
    cell: (c) => {
      const l = c.row.original;
      return (
        <span className="grid">
          <span className="font-medium">{l.description}</span>
          {l.rolls.length ? (
            <span className="text-xs text-fg-3">
              {l.rolls.length} roll{l.rolls.length === 1 ? "" : "s"}:{" "}
              {l.rolls
                .map((r) => r.barcode)
                .slice(0, 3)
                .join(", ")}
              {l.rolls.length > 3 ? ` +${l.rolls.length - 3}` : ""}
            </span>
          ) : null}
        </span>
      );
    },
  },
  {
    accessorKey: "hsnCode",
    header: "HSN",
    cell: (c) => <Mono className="text-xs">{c.getValue() as string}</Mono>,
  },
  {
    accessorKey: "metres",
    header: "Qty",
    meta: { numeric: true },
    cell: (c) => (c.getValue() === null ? "1" : metres(c.getValue() as number)),
  },
  {
    accessorKey: "ratePerM",
    header: "Rate ₹/m",
    meta: { numeric: true },
    cell: (c) => (c.getValue() ? D(c.getValue() as string).toFixed(2) : "—"),
  },
  {
    accessorKey: "discount",
    header: "Discount",
    meta: { numeric: true },
    cell: (c) => (D(c.getValue() as string).isZero() ? "—" : rupees(c.getValue() as string)),
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

function SiPage() {
  const { siId } = Route.useParams();
  const { data: me } = useQuery(meQuery);
  const { data: si } = useQuery(siQuery(siId));
  const [now] = useState(() => Date.now());
  const [dialog, setDialog] = useState<
    "post" | "discard" | "cancel" | "adjust" | "manual" | "eway" | "ewayManual" | null
  >(null);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  const onError = useApiErrorToast();
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: keys.sales }),
      queryClient.invalidateQueries({ queryKey: keys.inventory }),
    ]);

  const act = useMutation({
    mutationFn: ({ action, reason }: { action: "post" | "discard" | "cancel"; reason?: string }) =>
      docAction<SiDetail>(
        `/api/sales-invoices/{id}/${action}`,
        siId,
        { version: si!.version },
        reason,
      ),
    onSuccess: async (saved, { action }) => {
      setDialog(null);
      toast({
        tone: "success",
        title:
          action === "post"
            ? `Posted as ${saved.siNo}`
            : action === "discard"
              ? "Draft discarded"
              : `${saved.siNo} cancelled`,
        description:
          action === "post" && saved.einvoice.status === "Pending"
            ? "The IRN is being requested; the PDF is provisional until it arrives."
            : undefined,
      });
      await refresh();
    },
    onError: (e) => onError(e, keys.sales),
  });
  const retry = useMutation({
    mutationFn: () =>
      call<EInvoiceInfo>(() =>
        api.POST("/api/einvoice/{docType}/{id}/generate", {
          params: { path: { docType: "SI", id: siId } },
        }),
      ),
    onSuccess: async () => {
      toast({ tone: "success", title: "IRN generated" });
      await refresh();
    },
    onError: async (e) => {
      if (e instanceof ApiError)
        toast({
          tone: "danger",
          title: "The portal didn't accept it",
          description: e.problem.title,
        });
      else onError(e);
      await refresh();
    },
  });

  if (!si) return null;
  const draft = si.status === "Draft";
  const posted = si.status === "Posted";
  const manage = can(me, "sales.invoice.manage");
  const compliance = can(me, "compliance.einvoice.manage");
  const cancellable =
    posted &&
    si.source === "DC" &&
    can(me, "sales.invoice.cancel") &&
    Boolean(si.einvoice.cancellableUntil && Date.parse(si.einvoice.cancellableUntil) > now);
  const more = [
    ...(posted && can(me, "sales.return.manage")
      ? [
          {
            label: "Take goods back (return)",
            icon: Undo2,
            onSelect: () => void navigate({ to: "/sales/returns/new", search: { siId: si.id } }),
          },
        ]
      : []),
    ...(posted && can(me, "sales.note.manage")
      ? [
          {
            label: "Credit / debit note",
            icon: FileMinus2,
            onSelect: () => void navigate({ to: "/sales/notes/new", search: { siId: si.id } }),
          },
        ]
      : []),
    ...(cancellable
      ? [
          {
            label: "Cancel invoice",
            icon: XCircle,
            tone: "danger" as const,
            onSelect: () => setDialog("cancel"),
          },
        ]
      : []),
  ];

  return (
    <div className="grid gap-6">
      <PageHeader
        title={
          <DocTitle
            number={si.siNo}
            draftLabel="Draft invoice"
            status={si.status}
            tone={DOC_TONE[si.status] ?? "neutral"}
          />
        }
        description={
          <>
            <Link
              to="/customers/$customerId"
              params={{ customerId: si.customerId }}
              className="font-medium text-primary hover:underline"
            >
              {si.customerName}
            </Link>
            {` · ${si.date} · due ${si.dueDate}`}
          </>
        }
        breadcrumbs={[
          { label: "Sales" },
          { label: "Invoices", href: "/sales/invoices" },
          { label: si.siNo ?? "Draft" },
        ]}
        renderLink={crumbLink}
        actions={
          <>
            <PdfButton
              kind="sales-invoices"
              id={si.id}
              label={
                draft
                  ? "Preview PDF"
                  : si.einvoice.status === "Pending" || si.einvoice.status === "Failed"
                    ? "Provisional PDF"
                    : "Invoice PDF"
              }
            />
            {draft && manage ? (
              <>
                <Button
                  variant="secondary"
                  icon={SlidersHorizontal}
                  onClick={() => setDialog("adjust")}
                >
                  Charges & discount
                </Button>
                <Button variant="secondary" icon={XCircle} onClick={() => setDialog("discard")}>
                  Discard
                </Button>
                <Button
                  variant="primary"
                  icon={CheckCircle2}
                  disabled={si.blockers.length > 0}
                  onClick={() => setDialog("post")}
                >
                  Post invoice
                </Button>
              </>
            ) : null}
            {more.length ? (
              <DropdownMenu
                align="end"
                trigger={
                  <Button
                    variant="ghost"
                    iconOnly
                    icon={MoreHorizontal}
                    aria-label="More actions"
                  />
                }
                items={more}
              />
            ) : null}
          </>
        }
      />
      {si.blockers.length ? (
        <div className="grid gap-1 rounded-lg border border-danger/30 bg-danger-soft p-3 text-sm text-danger">
          <p className="flex items-center gap-2 font-medium">
            <AlertTriangle className="size-4" aria-hidden /> This invoice can't be posted yet
          </p>
          <ul className="list-disc pl-6">
            {si.blockers.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="grid gap-6 [&>*]:min-w-0 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="grid content-start gap-6">
          <Card title="Lines" padded={false}>
            <DataTable
              caption="Invoice lines"
              data={si.lines}
              columns={lineColumns}
              getRowId={(l) => l.id}
              pageSize={false}
            />
          </Card>
          <Card title="Bill to & ship to">
            <DefinitionList
              columns={2}
              items={[
                { label: "Billing address", value: si.billingAddress },
                { label: "Shipping address", value: si.shippingAddress },
                {
                  label: "GSTIN",
                  value: si.customerGstin ? <Mono>{si.customerGstin}</Mono> : "Unregistered",
                },
                { label: "Place of supply", value: placeOfSupply(si.placeOfSupply) },
                { label: "Supply type", value: si.supplyType },
                {
                  label: "From",
                  value: si.dcs.length ? (
                    <span className="flex flex-wrap gap-2">
                      {si.dcs.map((d) => (
                        <Link
                          key={d.id}
                          to="/sales/challans/$dcId"
                          params={{ dcId: d.id }}
                          className="text-primary hover:underline"
                        >
                          <Mono>{d.dcNo}</Mono>
                        </Link>
                      ))}
                    </span>
                  ) : si.source === "PROFORMA" ? (
                    "Proforma"
                  ) : (
                    "Direct sale"
                  ),
                },
              ]}
            />
          </Card>
          {posted || si.status === "Cancelled" ? <IrnLog siId={si.id} /> : null}
        </div>
        <div className="grid content-start gap-6">
          <TotalsCard totals={si.totals} />
          {si.cogs !== null && posted ? (
            <Card>
              <DefinitionList
                columns={2}
                items={[
                  {
                    label: "Cost of goods",
                    value: <span className="tnum">{rupees(si.cogs)}</span>,
                  },
                  {
                    label: "Margin",
                    value: (
                      <span className="tnum">
                        {rupees(D(si.totals.taxable).minus(si.cogs).toFixed(2))}
                      </span>
                    ),
                  },
                ]}
              />
            </Card>
          ) : null}
          {!draft ? (
            <EInvoiceCard
              info={si.einvoice}
              actions={
                compliance &&
                posted &&
                (si.einvoice.status === "Pending" || si.einvoice.status === "Failed") ? (
                  <>
                    <Button
                      size="sm"
                      variant="secondary"
                      icon={RefreshCw}
                      busy={retry.isPending}
                      onClick={() => retry.mutate()}
                    >
                      Retry now
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setDialog("manual")}>
                      Enter IRN by hand
                    </Button>
                  </>
                ) : null
              }
            />
          ) : null}
          {posted ? (
            <Card
              title="E-way bill"
              actions={si.transport.ewayBillNo ? <Badge tone="success">Done</Badge> : null}
            >
              {si.transport.ewayBillNo ? (
                <DefinitionList
                  columns={1}
                  items={[
                    { label: "Number", value: <Mono>{si.transport.ewayBillNo}</Mono> },
                    { label: "Date", value: si.transport.ewayBillDate ?? "—" },
                    { label: "Vehicle", value: si.transport.vehicleNo ?? "—" },
                  ]}
                />
              ) : (
                <div className="grid gap-3">
                  <p className="text-sm text-fg-2">
                    Needed when the goods are worth more than the threshold. Generate it from the
                    IRN, or enter one made on the e-way bill portal.
                  </p>
                  {compliance ? (
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        icon={Truck}
                        disabled={si.einvoice.status !== "Generated"}
                        title={
                          si.einvoice.status !== "Generated" ? "Needs the IRN first" : undefined
                        }
                        onClick={() => setDialog("eway")}
                      >
                        Generate from IRN
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setDialog("ewayManual")}>
                        Enter by hand
                      </Button>
                    </div>
                  ) : null}
                </div>
              )}
            </Card>
          ) : null}
          {si.notes ? (
            <Card title="Notes">
              <p className="text-sm">{si.notes}</p>
            </Card>
          ) : null}
        </div>
      </div>
      <ConfirmDialog
        open={dialog === "post" || dialog === "discard"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={dialog === "post" ? "Post this invoice?" : "Discard this draft?"}
        description={
          dialog === "post"
            ? `It gets the next invoice number and ${rupees(si.totals.total)} is added to ${si.customerName}'s account.${si.supplyType !== "B2C" ? " The IRN is requested right away." : ""}`
            : "Rolls held for it go back to stock."
        }
        confirmLabel={dialog === "post" ? "Post invoice" : "Discard draft"}
        tone={dialog === "discard" ? "danger" : "primary"}
        busy={act.isPending}
        onConfirm={() =>
          (dialog === "post" || dialog === "discard") && act.mutate({ action: dialog })
        }
      />
      <ReasonDialog
        open={dialog === "cancel"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={`Cancel ${si.siNo}?`}
        description={`Its IRN is cancelled on the portal and its challans reopen to be billed again. Possible until ${dateTime(si.einvoice.cancellableUntil)}; the number is not reused.`}
        confirmLabel="Cancel invoice"
        tone="danger"
        busy={act.isPending}
        onConfirm={(reason) => act.mutate({ action: "cancel", reason })}
      />
      {dialog === "adjust" ? <AdjustDrawer si={si} onClose={() => setDialog(null)} /> : null}
      {dialog === "manual" ? (
        <ManualIrnDialog siId={si.id} onClose={() => setDialog(null)} />
      ) : null}
      {dialog === "eway" ? <EwayDialog si={si} onClose={() => setDialog(null)} /> : null}
      {dialog === "ewayManual" ? (
        <EwayManualDialog siId={si.id} onClose={() => setDialog(null)} />
      ) : null}
    </div>
  );
}

function IrnLog({ siId }: { siId: string }) {
  const { data } = useQuery(irnRequestsQuery("SI", siId));
  if (!data?.length) return null;
  const ACTION: Record<string, string> = {
    GENERATE: "Report to IRP",
    CANCEL: "Cancel IRN",
    EWAY_BILL: "E-way bill",
    MANUAL: "Recorded by hand",
  };
  return (
    <Card title="E-invoice portal log">
      <ul className="grid gap-2 text-sm">
        {data.map((r) => (
          <li key={r.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <Badge tone={r.ok ? "success" : "danger"}>{r.ok ? "OK" : "Failed"}</Badge>
            <span className="font-medium">{ACTION[r.action] ?? r.action}</span>
            <span className="text-fg-3">
              {dateTime(r.createdAt)} · {r.provider}
              {r.durationMs !== null ? ` · ${r.durationMs} ms` : ""}
            </span>
            {r.error ? <span className="basis-full text-danger">{r.error}</span> : null}
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** Q21: extra charges and a bill discount, on a draft only. */
function AdjustDrawer({ si, onClose }: { si: SiDetail; onClose: () => void }) {
  const { data: settings } = useQuery(settingsQuery);
  const charges = settingValue<{ code: string; label: string; active: boolean }[]>(
    settings,
    "invoice.extraCharges",
    [],
  ).filter((c) => c.active);
  const existing = new Map(
    si.lines.filter((l) => l.kind === "CHARGE").map((l) => [l.description, l.taxable]),
  );
  const [amounts, setAmounts] = useState<Record<string, string>>(
    Object.fromEntries(charges.map((c) => [c.code, existing.get(c.label) ?? ""])),
  );
  const [billDiscount, setBillDiscount] = useState(
    D(si.billDiscount).isZero() ? "" : si.billDiscount,
  );
  const [date, setDate] = useState(si.date);
  const [notes, setNotes] = useState(si.notes ?? "");
  const queryClient = useQueryClient();
  const onError = useApiErrorToast();
  const save = useMutation({
    mutationFn: () =>
      call<SiDetail>(() =>
        api.PATCH("/api/sales-invoices/{id}", {
          params: { path: { id: si.id } },
          body: {
            date,
            billDiscount: billDiscount || "0",
            charges: Object.entries(amounts)
              .filter(([, a]) => a && !D(a).isZero())
              .map(([code, amount]) => ({ code, amount })),
            lineDiscounts: si.lines
              .filter((l) => l.kind === "GOODS" && !D(l.discountPct).isZero())
              .map((l) => ({ lineId: l.id, discountPct: l.discountPct })),
            notes: nullable(notes),
            version: si.version,
          },
        }),
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: keys.sales });
      onClose();
    },
    onError: (e) => onError(e, keys.sales),
  });
  return (
    <Drawer
      open
      onOpenChange={(o) => !o && onClose()}
      title="Charges & discount"
      description="Charges take the goods' GST rate. The bill discount is spread over the lines by value."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" busy={save.isPending} onClick={() => save.mutate()}>
            Apply
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <Field label="Invoice date">
          {(p) => (
            <TextInput {...p} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          )}
        </Field>
        {charges.map((c) => (
          <Field key={c.code} label={c.label}>
            {(p) => (
              <NumberInput
                {...p}
                prefix="₹"
                decimals={2}
                value={amounts[c.code] ?? ""}
                onValueChange={(v) => setAmounts((a) => ({ ...a, [c.code]: v }))}
              />
            )}
          </Field>
        ))}
        <Field label="Bill discount">
          {(p) => (
            <NumberInput
              {...p}
              prefix="₹"
              decimals={2}
              value={billDiscount}
              onValueChange={setBillDiscount}
            />
          )}
        </Field>
        <Field label="Notes on the invoice">
          {(p) => (
            <TextArea {...p} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          )}
        </Field>
      </div>
    </Drawer>
  );
}

function ManualIrnDialog({ siId, onClose }: { siId: string; onClose: () => void }) {
  const [irn, setIrn] = useState("");
  const [ackNo, setAckNo] = useState("");
  const [ackDate, setAckDate] = useState("");
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const queryClient = useQueryClient();
  const onError = useApiErrorToast();
  const save = useMutation({
    mutationFn: () =>
      call<EInvoiceInfo>(() =>
        api.POST("/api/einvoice/{docType}/{id}/manual", {
          params: { path: { docType: "SI", id: siId } },
          headers: reasonHeader(reason),
          body: {
            irn: irn.trim().toLowerCase(),
            ackNo: ackNo.trim(),
            ackDate: ackDate ? new Date(ackDate).toISOString() : "",
          },
        }),
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: keys.sales });
      onClose();
    },
    onError: (e) => {
      if (e instanceof ApiError) setErrors(e.fieldErrors());
      onError(e, keys.sales);
    },
  });
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Enter the IRN by hand"
      description="For an IRN generated on the e-invoice portal while ours was unavailable."
      width="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            busy={save.isPending}
            disabled={reason.trim().length < 3}
            onClick={() => save.mutate()}
          >
            Save IRN
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <Field label="IRN" required error={errors.irn} hint="64 characters">
          {(p) => (
            <TextInput
              {...p}
              className="font-mono"
              value={irn}
              onChange={(e) => setIrn(e.target.value)}
            />
          )}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Ack no." required error={errors.ackNo}>
            {(p) => (
              <TextInput
                {...p}
                inputMode="numeric"
                value={ackNo}
                onChange={(e) => setAckNo(e.target.value)}
              />
            )}
          </Field>
          <Field label="Ack date & time" required error={errors.ackDate}>
            {(p) => (
              <TextInput
                {...p}
                type="datetime-local"
                value={ackDate}
                onChange={(e) => setAckDate(e.target.value)}
              />
            )}
          </Field>
        </div>
        <Field label="Reason" required>
          {(p) => (
            <TextInput
              {...p}
              value={reason}
              placeholder="e.g. Portal API down at month end"
              onChange={(e) => setReason(e.target.value)}
            />
          )}
        </Field>
      </div>
    </Dialog>
  );
}

function EwayDialog({ si, onClose }: { si: SiDetail; onClose: () => void }) {
  const [distanceKm, setDistance] = useState(
    si.transport.distanceKm ? String(si.transport.distanceKm) : "",
  );
  const [vehicleNo, setVehicle] = useState(si.transport.vehicleNo ?? "");
  const queryClient = useQueryClient();
  const toast = useToast();
  const onError = useApiErrorToast();
  const save = useMutation({
    mutationFn: () =>
      call<EwayBillResult>(() =>
        api.POST("/api/einvoice/SI/{id}/eway-bill", {
          params: { path: { id: si.id } },
          body: { distanceKm: Number(distanceKm), vehicleNo: nullable(vehicleNo) },
        }),
      ),
    onSuccess: async (r) => {
      toast({
        tone: "success",
        title: `E-way bill ${r.ewayBillNo}`,
        description: r.validUntil ? `Valid until ${r.validUntil}` : undefined,
      });
      await queryClient.invalidateQueries({ queryKey: keys.sales });
      onClose();
    },
    onError: (e) => onError(e, keys.sales),
  });
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Generate e-way bill"
      description="Part A comes from the IRN; Part B from the vehicle. It is copied to the invoice's challans."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            icon={Truck}
            busy={save.isPending}
            disabled={!distanceKm}
            onClick={() => save.mutate()}
          >
            Generate
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Distance" required>
          {(p) => (
            <NumberInput
              {...p}
              value={distanceKm}
              onValueChange={setDistance}
              decimals={0}
              suffix="km"
            />
          )}
        </Field>
        <Field label="Vehicle no.">
          {(p) => (
            <TextInput
              {...p}
              value={vehicleNo}
              placeholder="GJ05AB1234"
              onChange={(e) => setVehicle(e.target.value)}
            />
          )}
        </Field>
      </div>
    </Dialog>
  );
}

function EwayManualDialog({ siId, onClose }: { siId: string; onClose: () => void }) {
  const [no, setNo] = useState("");
  const [date, setDate] = useState("");
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const queryClient = useQueryClient();
  const onError = useApiErrorToast();
  const save = useMutation({
    mutationFn: () =>
      call<EwayBillResult>(() =>
        api.POST("/api/einvoice/SI/{id}/eway-bill/manual", {
          params: { path: { id: siId } },
          headers: reasonHeader(reason),
          body: { ewayBillNo: no.trim(), ewayBillDate: date },
        }),
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: keys.sales });
      onClose();
    },
    onError: (e) => {
      if (e instanceof ApiError) setErrors(e.fieldErrors());
      onError(e, keys.sales);
    },
  });
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Enter e-way bill"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            busy={save.isPending}
            disabled={!no || !date || reason.trim().length < 3}
            onClick={() => save.mutate()}
          >
            Save
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="E-way bill no." required error={errors.ewayBillNo}>
          {(p) => (
            <TextInput
              {...p}
              inputMode="numeric"
              value={no}
              onChange={(e) => setNo(e.target.value)}
            />
          )}
        </Field>
        <Field label="Date" required error={errors.ewayBillDate}>
          {(p) => (
            <TextInput {...p} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          )}
        </Field>
        <Field label="Reason" required className="sm:col-span-2">
          {(p) => (
            <TextInput
              {...p}
              value={reason}
              placeholder="e.g. Made on the EWB portal by the transporter"
              onChange={(e) => setReason(e.target.value)}
            />
          )}
        </Field>
      </div>
    </Dialog>
  );
}
