import type { PiDetail } from "@erp/contracts";
import { formatINR } from "@erp/domain";
import {
  Badge,
  Button,
  Card,
  Checkbox,
  ConfirmDialog,
  DataTable,
  DefinitionList,
  Dialog,
  Mono,
  PageHeader,
  useToast,
} from "@erp/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { CheckCircle2, Link2, Pencil } from "lucide-react";
import { useState } from "react";
import { LandedCostCard } from "../../../../components/landed-cost.js";
import { PiForm } from "../../../../components/pi-form.js";
import { ReasonField } from "../../../../components/reason-field.js";
import { api, call, reasonHeader } from "../../../../lib/api.js";
import { useApiErrorToast } from "../../../../lib/errors.js";
import { dateTime } from "../../../../lib/format.js";
import { DOC_TONE, grnListQuery, piQuery } from "../../../../lib/purchase.js";
import { can, keys, meQuery } from "../../../../lib/queries.js";

export const Route = createFileRoute("/_app/purchase/invoices/$piId")({ component: PiPage });

type Line = PiDetail["lines"][number];
const columns: ColumnDef<Line, unknown>[] = [
  {
    accessorKey: "description",
    header: "Item",
    cell: (c) => (
      <div>
        <p className="font-medium">{c.row.original.description}</p>
        <p className="text-xs text-fg-3">
          HSN <Mono>{c.row.original.hsnCode}</Mono> · {c.row.original.gsm} GSM ·{" "}
          {c.row.original.widthIn}″{c.row.original.withoutPo ? " · " : ""}
          {c.row.original.withoutPo ? <Badge tone="warning">Not on PO</Badge> : null}
        </p>
      </div>
    ),
  },
  {
    accessorKey: "quantityM",
    header: "Metres",
    meta: { numeric: true },
    cell: (c) => (c.getValue() as number).toLocaleString("en-IN"),
  },
  {
    accessorKey: "ratePerM",
    header: "Rate ₹/m",
    meta: { numeric: true },
    cell: (c) => formatINR(c.getValue() as string),
  },
  {
    accessorKey: "discountPct",
    header: "Disc.",
    meta: { numeric: true },
    cell: (c) => (Number(c.getValue()) ? `${c.getValue() as string}%` : "—"),
  },
  {
    accessorKey: "gstRate",
    header: "GST",
    meta: { numeric: true },
    cell: (c) => `${c.getValue() as string}%`,
  },
  {
    accessorKey: "taxable",
    header: "Taxable",
    meta: { numeric: true },
    cell: (c) => formatINR(c.getValue() as string),
  },
];

function PiPage() {
  const { piId } = Route.useParams();
  const { data: me } = useQuery(meQuery);
  const { data: pi } = useQuery(piQuery(piId));
  const { data: grns } = useQuery(grnListQuery);
  const [editing, setEditing] = useState(false);
  const [posting, setPosting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [linking, setLinking] = useState<string[] | null>(null);
  const [reason, setReason] = useState("");
  const queryClient = useQueryClient();
  const toast = useToast();
  const onError = useApiErrorToast();
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: keys.purchase }),
      queryClient.invalidateQueries({ queryKey: keys.inventory }),
    ]);

  const post = useMutation({
    mutationFn: () =>
      call<PiDetail>(() =>
        api.POST("/api/purchase-invoices/{id}/post", {
          params: { path: { id: piId } },
          headers: reasonHeader(reason),
          body: { version: pi!.version },
        }),
      ),
    onSuccess: async (saved) => {
      setPosting(false);
      toast({
        tone: "success",
        title: `Posted as ${saved.piNo}`,
        description: `${saved.rollCount} rolls now carry this invoice's rates. Add landed cost next.`,
      });
      await refresh();
    },
    onError: (e) => onError(e, keys.purchase),
  });
  const cancel = useMutation({
    mutationFn: () =>
      call(() =>
        api.POST("/api/purchase-invoices/{id}/cancel", {
          params: { path: { id: piId } },
          body: { version: pi!.version },
        }),
      ),
    onSuccess: async () => {
      setCancelling(false);
      await refresh();
    },
    onError: (e) => onError(e),
  });
  const link = useMutation({
    mutationFn: (grnIds: string[]) =>
      call(() =>
        api.POST("/api/purchase-invoices/{id}/link-grns", {
          params: { path: { id: piId } },
          body: { grnIds },
        }),
      ),
    onSuccess: async () => {
      setLinking(null);
      toast({
        tone: "success",
        title: "Goods receipt linked",
        description: "Its rolls now carry this invoice's rates.",
      });
      await refresh();
    },
    onError: (e) => onError(e),
  });

  if (!pi) return null;
  const manage = can(me, "purchase.invoice.manage");
  const linkable = (grns ?? []).filter(
    (g) => g.status === "Posted" && g.supplierId === pi.supplierId && !pi.grnIds.includes(g.id),
  );

  return (
    <div className="grid gap-6">
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            {pi.supplierInvoiceNo}
            <Badge tone={DOC_TONE[pi.status]}>{pi.status}</Badge>
          </span>
        }
        description={`${pi.supplierName} · ${pi.supplierInvoiceDate}${pi.piNo ? ` · our ref ${pi.piNo}` : ""}`}
        breadcrumbs={[
          { label: "Purchase" },
          { label: "Purchase invoices", href: "/purchase/invoices" },
          { label: pi.supplierInvoiceNo },
        ]}
        renderLink={(crumb, className) => (
          <Link to={crumb.href!} className={className}>
            {crumb.label}
          </Link>
        )}
        actions={
          <>
            {pi.status === "Draft" && manage && !editing ? (
              <Button variant="secondary" icon={Pencil} onClick={() => setEditing(true)}>
                Edit
              </Button>
            ) : null}
            {pi.status === "Draft" && manage ? (
              <Button variant="secondary" onClick={() => setCancelling(true)}>
                Cancel draft
              </Button>
            ) : null}
            {pi.status === "Draft" && manage ? (
              <Button variant="primary" icon={CheckCircle2} onClick={() => setPosting(true)}>
                Post invoice
              </Button>
            ) : null}
            {pi.status === "Posted" && manage && linkable.length ? (
              <Button variant="secondary" icon={Link2} onClick={() => setLinking([])}>
                Link goods receipt
              </Button>
            ) : null}
          </>
        }
      />
      {editing ? (
        <PiForm pi={pi} onDone={() => setEditing(false)} />
      ) : (
        <>
          <Card>
            <DefinitionList
              columns={3}
              items={[
                {
                  label: "Taxable value",
                  value: <span className="tnum">{formatINR(pi.totals.taxable)}</span>,
                },
                {
                  label: pi.regime === "IGST" ? "IGST" : "CGST + SGST",
                  value: (
                    <span className="tnum">
                      {pi.regime === "IGST"
                        ? formatINR(pi.totals.igst)
                        : `${formatINR(pi.totals.cgst)} + ${formatINR(pi.totals.sgst)}`}
                    </span>
                  ),
                },
                {
                  label: "Round-off",
                  value: <span className="tnum">{formatINR(pi.totals.roundOff)}</span>,
                },
                {
                  label: "Invoice total",
                  value: <span className="tnum font-semibold">{formatINR(pi.totals.total)}</span>,
                },
                {
                  label: "Rolls covered",
                  value: pi.rollCount ? `${pi.rollCount} rolls` : "None yet",
                },
                { label: "Purchase order", value: pi.poNo ?? "—" },
                {
                  label: "IRN",
                  value: pi.irn ? <Mono className="break-all text-xs">{pi.irn}</Mono> : "—",
                },
                { label: "E-way bill", value: pi.ewayBillNo ?? "—" },
                { label: "Posted", value: pi.postedAt ? dateTime(pi.postedAt) : "Not yet" },
              ]}
            />
          </Card>
          <Card title="Lines" padded={false}>
            <DataTable
              caption="Purchase invoice lines"
              data={pi.lines}
              columns={columns}
              getRowId={(l) => l.id}
              pageSize={false}
            />
          </Card>
          {pi.status === "Posted" ? (
            <LandedCostCard pi={pi} editable={can(me, "purchase.landed_cost.manage")} />
          ) : null}
        </>
      )}
      {posting ? (
        <Dialog
          open
          onOpenChange={(o) => !o && setPosting(false)}
          title="Post this purchase invoice?"
          description={`Total ${formatINR(pi.totals.total)}. Check it matches the supplier's bill — it can't be edited after posting.`}
          footer={
            <>
              <Button variant="secondary" onClick={() => setPosting(false)}>
                Back
              </Button>
              <Button
                variant="primary"
                busy={post.isPending}
                disabled={pi.linesWithoutPo > 0 && !reason.trim()}
                onClick={() => post.mutate()}
              >
                Post invoice
              </Button>
            </>
          }
        >
          {pi.linesWithoutPo ? (
            <div className="grid gap-3">
              <p className="rounded-md bg-warning-soft px-3 py-2 text-sm text-warning">
                {pi.linesWithoutPo} line{pi.linesWithoutPo > 1 ? "s are" : " is"} not on a purchase
                order. Say why — it's kept in the audit log and the variance report.
              </p>
              <ReasonField value={reason} onChange={setReason} required />
            </div>
          ) : null}
        </Dialog>
      ) : null}
      {linking ? (
        <Dialog
          open
          onOpenChange={(o) => !o && setLinking(null)}
          title="Link goods receipts"
          description="For goods that arrived after this invoice. Their rolls take its rates."
          footer={
            <>
              <Button variant="secondary" onClick={() => setLinking(null)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                disabled={!linking.length}
                busy={link.isPending}
                onClick={() => link.mutate(linking)}
              >
                Link
              </Button>
            </>
          }
        >
          <div className="grid gap-2">
            {linkable.map((g) => (
              <Checkbox
                key={g.id}
                label={`${g.grnNo} · ${g.date} · ${g.rollCount} rolls`}
                checked={linking.includes(g.id)}
                onCheckedChange={(on) =>
                  setLinking(on ? [...linking, g.id] : linking.filter((x) => x !== g.id))
                }
              />
            ))}
          </div>
        </Dialog>
      ) : null}
      <ConfirmDialog
        open={cancelling}
        onOpenChange={setCancelling}
        title="Cancel this draft?"
        confirmLabel="Cancel draft"
        tone="danger"
        busy={cancel.isPending}
        onConfirm={() => cancel.mutate()}
      />
    </div>
  );
}
