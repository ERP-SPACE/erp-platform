import type { PoDetail } from "@erp/contracts";
import { formatINR } from "@erp/domain";
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  DataTable,
  DefinitionList,
  Mono,
  PageHeader,
  useToast,
} from "@erp/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { CheckCircle2, PackageCheck, Pencil, XCircle } from "lucide-react";
import { useState } from "react";
import { PoForm } from "../../../../components/po-form.js";
import { api, call } from "../../../../lib/api.js";
import { useApiErrorToast } from "../../../../lib/errors.js";
import { dateTime } from "../../../../lib/format.js";
import { PO_TONE, ROLL_LABEL, poQuery } from "../../../../lib/purchase.js";
import { can, keys, meQuery } from "../../../../lib/queries.js";

export const Route = createFileRoute("/_app/purchase/orders/$poId")({ component: PoPage });

type Line = PoDetail["lines"][number];
const columns: ColumnDef<Line, unknown>[] = [
  {
    accessorKey: "description",
    header: "Item",
    cell: (c) => (
      <div>
        <p className="font-medium">{c.row.original.description}</p>
        <p className="text-xs text-fg-3">
          {c.row.original.skuCode ? <Mono>{c.row.original.skuCode}</Mono> : "Not in catalogue"} ·{" "}
          {c.row.original.gsm} GSM · {c.row.original.widthIn}″
        </p>
      </div>
    ),
  },
  {
    accessorKey: "quantityM",
    header: "Ordered",
    meta: { numeric: true },
    cell: (c) => `${(c.getValue() as number).toLocaleString("en-IN")} m`,
  },
  {
    accessorKey: "ratePerM",
    header: "Rate ₹/m",
    meta: { numeric: true },
    cell: (c) => formatINR(c.getValue() as string),
  },
  {
    accessorKey: "amount",
    header: "Amount",
    meta: { numeric: true },
    cell: (c) => formatINR(c.getValue() as string),
  },
  {
    accessorKey: "receivedM",
    header: "Received",
    meta: { numeric: true },
    cell: (c) => `${(c.getValue() as number).toLocaleString("en-IN")} m`,
  },
  {
    accessorKey: "balanceM",
    header: "Balance",
    meta: { numeric: true },
    cell: (c) => `${(c.getValue() as number).toLocaleString("en-IN")} m`,
  },
];

function PoPage() {
  const { poId } = Route.useParams();
  const { data: me } = useQuery(meQuery);
  const { data: po } = useQuery(poQuery(poId));
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState<"close" | "cancel" | null>(null);
  const queryClient = useQueryClient();
  const toast = useToast();
  const onError = useApiErrorToast();
  const act = useMutation({
    mutationFn: (action: "approve" | "close" | "cancel") =>
      call<PoDetail>(() =>
        api.POST(`/api/purchase-orders/{id}/${action}`, {
          params: { path: { id: poId } },
          body: { version: po!.version },
        }),
      ),
    onSuccess: async (saved) => {
      setConfirm(null);
      toast({
        tone: "success",
        title: `${saved.poNo} is ${ROLL_LABEL[saved.status] ?? saved.status}`,
      });
      await queryClient.invalidateQueries({ queryKey: keys.purchase });
    },
    onError: (e) => onError(e, keys.purchase),
  });
  if (!po) return null;
  const approver = can(me, "purchase.order.approve");

  return (
    <div className="grid gap-6">
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            <Mono>{po.poNo}</Mono>
            <Badge tone={PO_TONE[po.status]}>{ROLL_LABEL[po.status] ?? po.status}</Badge>
          </span>
        }
        description={`${po.supplierName} · ${po.date}`}
        breadcrumbs={[
          { label: "Purchase" },
          { label: "Purchase orders", href: "/purchase/orders" },
          { label: po.poNo },
        ]}
        renderLink={(crumb, className) => (
          <Link to={crumb.href!} className={className}>
            {crumb.label}
          </Link>
        )}
        actions={
          <>
            {po.status === "Draft" && can(me, "purchase.order.manage") && !editing ? (
              <Button variant="secondary" icon={Pencil} onClick={() => setEditing(true)}>
                Edit
              </Button>
            ) : null}
            {po.status === "Draft" && approver ? (
              <Button
                variant="primary"
                icon={CheckCircle2}
                busy={act.isPending}
                onClick={() => act.mutate("approve")}
              >
                Approve
              </Button>
            ) : null}
            {(po.status === "Approved" || po.status === "PartiallyReceived") &&
            can(me, "purchase.receipt.manage") ? (
              <Button asChild variant="primary" icon={PackageCheck}>
                <Link to="/purchase/receipts/new" search={{ poId: po.id }}>
                  Receive goods
                </Link>
              </Button>
            ) : null}
            {(po.status === "Approved" || po.status === "PartiallyReceived") && approver ? (
              <Button variant="secondary" onClick={() => setConfirm("close")}>
                Close
              </Button>
            ) : null}
            {(po.status === "Draft" || po.status === "Approved") && approver ? (
              <Button variant="danger" icon={XCircle} onClick={() => setConfirm("cancel")}>
                Cancel order
              </Button>
            ) : null}
          </>
        }
      />
      {editing ? (
        <PoForm po={po} onDone={() => setEditing(false)} />
      ) : (
        <>
          <Card>
            <DefinitionList
              columns={3}
              items={[
                {
                  label: "Value excl. GST",
                  value: <span className="tnum">{formatINR(po.totals.taxable)}</span>,
                },
                {
                  label: po.regime === "IGST" ? "IGST" : "CGST + SGST",
                  value: <span className="tnum">{formatINR(po.totals.tax)}</span>,
                },
                {
                  label: "Total",
                  value: <span className="tnum font-semibold">{formatINR(po.totals.total)}</span>,
                },
                { label: "Expected by", value: po.expectedDate ?? "—" },
                {
                  label: "Approved",
                  value: po.approvedAt
                    ? `${dateTime(po.approvedAt)} · ${po.approvedByName ?? ""}`
                    : "—",
                },
                { label: "Notes", value: po.notes ?? "—" },
              ]}
            />
          </Card>
          <Card title="Lines" padded={false}>
            <DataTable
              caption="Purchase order lines"
              data={po.lines}
              columns={columns}
              getRowId={(l) => l.id}
              pageSize={false}
            />
          </Card>
        </>
      )}
      <ConfirmDialog
        open={Boolean(confirm)}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={confirm === "close" ? "Close this purchase order?" : "Cancel this purchase order?"}
        description={
          confirm === "close"
            ? "No more goods will be received against it."
            : "It can't be used again. Orders with receipts can only be closed."
        }
        confirmLabel={confirm === "close" ? "Close order" : "Cancel order"}
        tone={confirm === "cancel" ? "danger" : "primary"}
        busy={act.isPending}
        onConfirm={() => confirm && act.mutate(confirm)}
      />
    </div>
  );
}
