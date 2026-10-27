import type { GrnDetail, Problem } from "@erp/contracts";
import {
  Badge,
  Button,
  Card,
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
import { CheckCircle2, FileInput, Pencil, Printer, ShieldAlert } from "lucide-react";
import { useState } from "react";
import { GrnForm } from "../../../../components/grn-form.js";
import { ReasonField } from "../../../../components/reason-field.js";
import { RollTable } from "../../../../components/roll-table.js";
import { ApiError, api, call, reasonHeader } from "../../../../lib/api.js";
import { useApiErrorToast } from "../../../../lib/errors.js";
import { dateTime } from "../../../../lib/format.js";
import { DOC_TONE, grnQuery, printLabels, rollsQuery } from "../../../../lib/purchase.js";
import { can, keys, meQuery } from "../../../../lib/queries.js";

export const Route = createFileRoute("/_app/purchase/receipts/$grnId")({ component: GrnPage });

type Line = GrnDetail["lines"][number];
const columns: ColumnDef<Line, unknown>[] = [
  {
    accessorKey: "description",
    header: "Item",
    cell: (c) => (
      <div>
        <p className="font-medium">{c.row.original.description}</p>
        <p className="text-xs text-fg-3">
          {c.row.original.skuCode ? (
            <Mono>{c.row.original.skuCode}</Mono>
          ) : (
            <Badge tone="warning">Unmapped</Badge>
          )}{" "}
          · {c.row.original.gsm} GSM · {c.row.original.widthIn}″
        </p>
      </div>
    ),
  },
  {
    accessorKey: "rolls",
    header: "Rolls as billed",
    cell: (c) => <Mono className="text-xs">{c.getValue() as string}</Mono>,
  },
  { accessorKey: "rollCount", header: "Rolls", meta: { numeric: true } },
  {
    accessorKey: "acceptedM",
    header: "Metres",
    meta: { numeric: true },
    cell: (c) => `${(c.getValue() as number).toLocaleString("en-IN")} m`,
  },
  {
    accessorKey: "rejectedCount",
    header: "Rejected",
    meta: { numeric: true },
    cell: (c) =>
      c.getValue() ? `${c.getValue() as number} (${c.row.original.rejectReason ?? ""})` : "—",
  },
  {
    accessorKey: "overReceiptM",
    header: "Over PO",
    meta: { numeric: true },
    cell: (c) =>
      c.getValue() ? (
        <Badge tone="warning">{(c.getValue() as number).toLocaleString("en-IN")} m</Badge>
      ) : (
        "—"
      ),
  },
];

function GrnPage() {
  const { grnId } = Route.useParams();
  const { data: me } = useQuery(meQuery);
  const { data: grn } = useQuery(grnQuery(grnId));
  const rolls = useQuery({ ...rollsQuery({ grnId }), enabled: grn?.status === "Posted" });
  const [editing, setEditing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [approval, setApproval] = useState<Problem | null>(null);
  const [reason, setReason] = useState("");
  const [printing, setPrinting] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const toast = useToast();
  const onError = useApiErrorToast();
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: keys.purchase }),
      queryClient.invalidateQueries({ queryKey: keys.inventory }),
    ]);

  const post = useMutation({
    mutationFn: (overReceipt: boolean) =>
      call<GrnDetail>(() =>
        overReceipt
          ? api.POST("/api/goods-receipts/{id}/post-over-receipt", {
              params: { path: { id: grnId } },
              headers: reasonHeader(reason),
              body: { version: grn!.version, approveOverReceipt: true },
            })
          : api.POST("/api/goods-receipts/{id}/post", {
              params: { path: { id: grnId } },
              body: { version: grn!.version, approveOverReceipt: false },
            }),
      ),
    onSuccess: async (saved) => {
      setApproval(null);
      toast({
        tone: "success",
        title: `${saved.grnNo} posted`,
        description: `${saved.rollCount} rolls created${saved.unmappedRolls ? `, ${saved.unmappedRolls} need mapping` : ""}. Print their labels next.`,
      });
      await refresh();
    },
    onError: (error) => {
      if (error instanceof ApiError && error.code === "APPROVAL_REQUIRED") {
        setApproval(error.problem);
        return;
      }
      onError(error, keys.purchase);
    },
  });
  const cancel = useMutation({
    mutationFn: () =>
      call(() =>
        api.POST("/api/goods-receipts/{id}/cancel", {
          params: { path: { id: grnId } },
          body: { version: grn!.version },
        }),
      ),
    onSuccess: async () => {
      setCancelling(false);
      toast({ tone: "success", title: "Draft cancelled" });
      await refresh();
    },
    onError: (e) => onError(e, keys.purchase),
  });
  const print = useMutation({
    mutationFn: () =>
      printLabels({ grnId }, undefined, (s) => setPrinting(`${s.done} of ${s.count} labels…`)),
    onSettled: () => setPrinting(null),
    onSuccess: () =>
      toast({
        tone: "success",
        title: "Labels ready",
        description: "Opened in a new tab for printing.",
      }),
    onError: (e) => onError(e),
  });

  if (!grn) return null;
  const manage = can(me, "purchase.receipt.manage");

  return (
    <div className="grid gap-6">
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            <Mono>{grn.grnNo}</Mono>
            <Badge tone={DOC_TONE[grn.status]}>{grn.status}</Badge>
          </span>
        }
        description={`${grn.supplierName} · ${grn.date}${grn.poNo ? ` · against ${grn.poNo}` : ""}`}
        breadcrumbs={[
          { label: "Purchase" },
          { label: "Goods receipts", href: "/purchase/receipts" },
          { label: grn.grnNo },
        ]}
        renderLink={(crumb, className) => (
          <Link to={crumb.href!} className={className}>
            {crumb.label}
          </Link>
        )}
        actions={
          <>
            {grn.status === "Created" && manage && !editing ? (
              <Button variant="secondary" icon={Pencil} onClick={() => setEditing(true)}>
                Edit
              </Button>
            ) : null}
            {grn.status === "Created" && manage ? (
              <Button variant="secondary" onClick={() => setCancelling(true)}>
                Cancel draft
              </Button>
            ) : null}
            {grn.status === "Created" && manage ? (
              <Button
                variant="primary"
                icon={CheckCircle2}
                busy={post.isPending}
                onClick={() => post.mutate(false)}
              >
                Post receipt
              </Button>
            ) : null}
            {grn.status === "Posted" && can(me, "labels.print") ? (
              <Button
                variant="primary"
                icon={Printer}
                busy={print.isPending}
                onClick={() => print.mutate()}
              >
                {printing ?? "Print labels"}
              </Button>
            ) : null}
            {grn.status === "Posted" && can(me, "purchase.invoice.manage") ? (
              <Button asChild variant="secondary" icon={FileInput}>
                <Link to="/purchase/invoices/new" search={{ grnId: grn.id }}>
                  Enter purchase invoice
                </Link>
              </Button>
            ) : null}
          </>
        }
      />
      {editing ? (
        <GrnForm grn={grn} onDone={() => setEditing(false)} />
      ) : (
        <>
          <Card>
            <DefinitionList
              columns={3}
              items={[
                {
                  label: "Rolls",
                  value: (
                    <span className="tnum">
                      {grn.rollCount} · {grn.acceptedM.toLocaleString("en-IN")} m
                    </span>
                  ),
                },
                { label: "Supplier's bill", value: grn.supplierInvoiceNo ?? "—" },
                {
                  label: "Lot",
                  value: grn.batchCode ? (
                    <span>
                      <Mono>{grn.batchCode}</Mono>
                      {grn.supplierBatchRef ? ` · ${grn.supplierBatchRef}` : ""}
                    </span>
                  ) : (
                    (grn.supplierBatchRef ?? "Assigned on posting")
                  ),
                },
                { label: "Vehicle", value: grn.vehicleNo ?? "—" },
                { label: "Posted", value: grn.postedAt ? dateTime(grn.postedAt) : "Not yet" },
                { label: "Over-receipt approved by", value: grn.overReceiptApprovedByName ?? "—" },
              ]}
            />
          </Card>
          <Card title="Lines" padded={false}>
            <DataTable
              caption="Goods receipt lines"
              data={grn.lines}
              columns={columns}
              getRowId={(l) => l.id}
              pageSize={false}
            />
          </Card>
          {grn.status === "Posted" ? (
            <Card
              title="Rolls"
              description={
                grn.unmappedRolls
                  ? `${grn.unmappedRolls} rolls are Unmapped — match them to a product in Inventory.`
                  : undefined
              }
              actions={
                grn.unmappedRolls ? (
                  <Button asChild size="sm" variant="secondary">
                    <Link to="/inventory/unmapped">Map rolls</Link>
                  </Button>
                ) : null
              }
              padded={false}
            >
              <RollTable
                caption="Rolls on this receipt"
                rolls={rolls.data?.items ?? []}
                loading={rolls.isLoading}
                showCost={can(me, "inventory.view_cost")}
              />
            </Card>
          ) : null}
        </>
      )}
      <ConfirmDialog
        open={cancelling}
        onOpenChange={setCancelling}
        title="Cancel this draft?"
        description="No rolls were created. The receipt number stays used."
        confirmLabel="Cancel draft"
        tone="danger"
        busy={cancel.isPending}
        onConfirm={() => cancel.mutate()}
      />
      {approval ? (
        <Dialog
          open
          onOpenChange={(o) => !o && setApproval(null)}
          title="More than the purchase order"
          description={approval.title}
          footer={
            <>
              <Button variant="secondary" onClick={() => setApproval(null)}>
                Back
              </Button>
              {can(me, "purchase.over_receipt.approve") ? (
                <Button
                  variant="primary"
                  icon={ShieldAlert}
                  disabled={!reason.trim()}
                  busy={post.isPending}
                  onClick={() => post.mutate(true)}
                >
                  Approve and post
                </Button>
              ) : null}
            </>
          }
        >
          <div className="grid gap-4">
            <ul className="list-inside list-disc text-sm text-fg-2">
              {(approval.issues ?? []).map((i) => (
                <li key={i.path}>{i.message}</li>
              ))}
            </ul>
            {can(me, "purchase.over_receipt.approve") ? (
              <ReasonField value={reason} onChange={setReason} required />
            ) : (
              <p className="rounded-md bg-warning-soft px-3 py-2 text-sm text-warning">
                Ask a purchase manager to approve this receipt.
              </p>
            )}
          </div>
        </Dialog>
      ) : null}
    </div>
  );
}
