import type { DcDetail, SoDetail } from "@erp/contracts";
import { D, istToday } from "@erp/domain";
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  DataTable,
  DefinitionList,
  DropdownMenu,
  EmptyState,
  Mono,
  PageHeader,
  useToast,
} from "@erp/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import {
  BadgeCheck,
  CheckCircle2,
  MoreHorizontal,
  PauseCircle,
  Pencil,
  ReceiptText,
  RefreshCw,
  ShieldCheck,
  Truck,
  XCircle,
} from "lucide-react";
import { useState } from "react";
import {
  CreditPanel,
  DocTitle,
  ReasonDialog,
  TotalsCard,
  crumbLink,
} from "../../../../components/sales-bits.js";
import { SoForm } from "../../../../components/so-form.js";
import { api, call } from "../../../../lib/api.js";
import { useApiErrorToast } from "../../../../lib/errors.js";
import { can, keys, meQuery } from "../../../../lib/queries.js";
import {
  DC_TONE,
  DOC_TONE,
  RATE_SOURCE_LABEL,
  SO_TONE,
  allocationQuery,
  docAction,
  metres,
  soQuery,
  rupees,
  placeOfSupply,
} from "../../../../lib/sales.js";

export const Route = createFileRoute("/_app/sales/orders/$soId")({ component: SoPage });

type Line = SoDetail["lines"][number];
const lineColumns: ColumnDef<Line, unknown>[] = [
  {
    accessorKey: "description",
    header: "Product",
    cell: (c) => (
      <span className="grid">
        <span className="font-medium">{c.row.original.description}</span>
        <Mono className="text-xs text-fg-3">{c.row.original.skuCode}</Mono>
      </span>
    ),
  },
  {
    accessorKey: "totalM",
    header: "Ordered",
    meta: { numeric: true },
    cell: (c) => metres(c.getValue() as number),
  },
  {
    id: "rate",
    header: "Rate ₹/m",
    meta: { numeric: true },
    cell: (c) => {
      const l = c.row.original;
      return (
        <span className="grid justify-items-end gap-0.5">
          <span className="tnum">{D(l.ratePerM).toFixed(2)}</span>
          <span className="whitespace-nowrap text-xs text-fg-3">
            {l.derivedRatePerM
              ? `derived ${D(l.derivedRatePerM).toFixed(2)}`
              : RATE_SOURCE_LABEL[l.rateSource]}
            {l.deviationPct && !D(l.deviationPct).isZero()
              ? ` · ${D(l.deviationPct).toFixed(1)} %`
              : ""}
          </span>
          {l.needsApproval ? (
            <Badge tone={l.approvedByName ? "success" : "warning"}>
              {l.approvedByName ? `Approved · ${l.approvedByName}` : "Needs approval"}
            </Badge>
          ) : null}
        </span>
      );
    },
  },
  {
    accessorKey: "amount",
    header: "Amount",
    meta: { numeric: true },
    cell: (c) => rupees(c.getValue() as string),
  },
  {
    accessorKey: "dispatchedM",
    header: "Dispatched",
    meta: { numeric: true },
    cell: (c) => metres(c.getValue() as number),
  },
  {
    accessorKey: "balanceM",
    header: "Balance",
    meta: { numeric: true },
    cell: (c) => <span className="font-medium">{metres(c.getValue() as number)}</span>,
  },
];

type Action = "confirm" | "approve-rates" | "recheck" | "release" | "hold" | "close" | "cancel";
const DONE: Record<Action, string> = {
  confirm: "Order confirmed",
  "approve-rates": "Rates approved",
  recheck: "Credit re-checked",
  release: "Credit hold released",
  hold: "Order put on hold",
  close: "Order closed",
  cancel: "Order cancelled",
};

function SoPage() {
  const { soId } = Route.useParams();
  const { data: me } = useQuery(meQuery);
  const { data: so } = useQuery(soQuery(soId));
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState<"close" | "cancel" | null>(null);
  const [reasonFor, setReasonFor] = useState<"release" | "hold" | null>(null);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  const onError = useApiErrorToast();

  const act = useMutation({
    mutationFn: ({ action, reason }: { action: Action; reason?: string }) =>
      docAction<SoDetail>(
        `/api/sales-orders/{id}/${action}`,
        soId,
        { version: so!.version },
        reason,
      ),
    onSuccess: async (saved, { action }) => {
      setConfirm(null);
      setReasonFor(null);
      const held = action === "confirm" && saved.status === "OnHold";
      toast({
        tone: held ? "warning" : "success",
        title: held ? "Order is on hold for credit" : DONE[action],
        description: held
          ? "Exposure would pass the customer's terms. Release it with a reason, or wait for payment."
          : undefined,
      });
      await queryClient.invalidateQueries({ queryKey: keys.sales });
    },
    onError: (e) => onError(e, keys.sales),
  });
  const newDc = useMutation({
    mutationFn: () =>
      call<DcDetail>(() =>
        api.POST("/api/delivery-challans", { body: { soId, date: istToday() } }),
      ),
    onSuccess: async (dc) => {
      await queryClient.invalidateQueries({ queryKey: keys.sales });
      void navigate({ to: "/sales/challans/$dcId", params: { dcId: dc.id } });
    },
    onError: (e) => onError(e, keys.sales),
  });

  if (!so) return null;
  if (editing) {
    return (
      <div className="grid gap-6">
        <PageHeader
          title={
            <>
              Edit <Mono>{so.soNo}</Mono>
            </>
          }
          breadcrumbs={[
            { label: "Sales" },
            { label: "Orders", href: "/sales/orders" },
            { label: so.soNo },
          ]}
          renderLink={crumbLink}
        />
        <SoForm so={so} onDone={() => setEditing(false)} />
      </div>
    );
  }
  const manage = can(me, "sales.order.manage");
  const open = so.status === "Confirmed" || so.status === "PartiallyFulfilled";
  const busy = (a: Action) => act.isPending && act.variables?.action === a;
  const more = [
    ...(open && can(me, "sales.credit.release")
      ? [{ label: "Put on hold", icon: PauseCircle, onSelect: () => setReasonFor("hold") }]
      : []),
    ...(open && manage
      ? [{ label: "Close (short-close)", icon: CheckCircle2, onSelect: () => setConfirm("close") }]
      : []),
    ...(manage && ["Draft", "Confirmed", "OnHold"].includes(so.status)
      ? [
          {
            label: "Cancel order",
            icon: XCircle,
            tone: "danger" as const,
            onSelect: () => setConfirm("cancel"),
          },
        ]
      : []),
  ];

  return (
    <div className="grid gap-6">
      <PageHeader
        title={
          <DocTitle
            number={so.soNo}
            draftLabel="Draft order"
            status={so.status}
            tone={SO_TONE[so.status]}
          />
        }
        description={
          <>
            <Link
              to="/customers/$customerId"
              params={{ customerId: so.customerId }}
              className="font-medium text-primary hover:underline"
            >
              {so.customerName}
            </Link>
            {` · ${so.date}${so.salesmanName ? ` · ${so.salesmanName}` : ""}${so.customerRef ? ` · ref ${so.customerRef}` : ""}`}
          </>
        }
        breadcrumbs={[
          { label: "Sales" },
          { label: "Orders", href: "/sales/orders" },
          { label: so.soNo },
        ]}
        renderLink={crumbLink}
        actions={
          <>
            {so.status === "Draft" && manage ? (
              <Button variant="secondary" icon={Pencil} onClick={() => setEditing(true)}>
                Edit
              </Button>
            ) : null}
            {so.status === "Draft" && so.pendingApproval && can(me, "pricing.override.approve") ? (
              <Button
                variant="secondary"
                icon={BadgeCheck}
                busy={busy("approve-rates")}
                onClick={() => act.mutate({ action: "approve-rates" })}
              >
                Approve rates
              </Button>
            ) : null}
            {so.status === "Draft" && manage ? (
              <Button
                variant="primary"
                icon={ShieldCheck}
                busy={busy("confirm")}
                disabled={so.pendingApproval}
                title={so.pendingApproval ? "A manager must approve the rates first" : undefined}
                onClick={() => act.mutate({ action: "confirm" })}
              >
                Confirm order
              </Button>
            ) : null}
            {so.status === "OnHold" && manage && so.heldReasons.length ? (
              <Button
                variant="secondary"
                icon={RefreshCw}
                busy={busy("recheck")}
                onClick={() => act.mutate({ action: "recheck" })}
              >
                Re-check credit
              </Button>
            ) : null}
            {so.status === "OnHold" && can(me, "sales.credit.release") ? (
              <Button variant="primary" icon={ShieldCheck} onClick={() => setReasonFor("release")}>
                Release hold
              </Button>
            ) : null}
            {open && can(me, "sales.invoice.manage") ? (
              <Button asChild variant="secondary" icon={ReceiptText}>
                <Link to="/sales/invoices/new" search={{ source: "DIRECT", soId: so.id }}>
                  Direct invoice
                </Link>
              </Button>
            ) : null}
            {open && can(me, "sales.dispatch.manage") ? (
              <Button
                variant="primary"
                icon={Truck}
                busy={newDc.isPending}
                onClick={() => newDc.mutate()}
              >
                New challan
              </Button>
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
      {so.pendingApproval && so.status === "Draft" ? (
        <div className="rounded-lg border border-warning/30 bg-warning-soft p-3 text-sm text-warning">
          Some rates are outside the allowed range. A manager approves them (with their password)
          before the order can be confirmed.
        </div>
      ) : null}
      <div className="grid gap-6 [&>*]:min-w-0 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="grid content-start gap-6">
          <Card title="Lines" padded={false}>
            <DataTable
              caption="Order lines"
              data={so.lines}
              columns={lineColumns}
              getRowId={(l) => l.id}
              pageSize={false}
            />
          </Card>
          {open ? <AllocationCard soId={so.id} /> : null}
          <Card title="Challans & invoices">
            {so.dcs.length || so.invoices.length ? (
              <ul className="grid gap-2 text-sm">
                {so.dcs.map((d) => (
                  <li key={d.id} className="flex items-center gap-3">
                    <Truck className="size-4 text-fg-3" aria-hidden />
                    <Link
                      to="/sales/challans/$dcId"
                      params={{ dcId: d.id }}
                      className="text-primary hover:underline"
                    >
                      <Mono>{d.dcNo}</Mono>
                    </Link>
                    <Badge tone={DC_TONE[d.status]}>{d.status}</Badge>
                  </li>
                ))}
                {so.invoices.map((i) => (
                  <li key={i.id} className="flex items-center gap-3">
                    <ReceiptText className="size-4 text-fg-3" aria-hidden />
                    <Link
                      to="/sales/invoices/$siId"
                      params={{ siId: i.id }}
                      className="text-primary hover:underline"
                    >
                      <Mono>{i.siNo ?? "Draft invoice"}</Mono>
                    </Link>
                    <Badge tone={DOC_TONE[i.status] ?? "neutral"}>{i.status}</Badge>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-fg-2">Nothing dispatched yet.</p>
            )}
          </Card>
        </div>
        <div className="grid content-start gap-6">
          <TotalsCard totals={so.totals} />
          {so.credit ? (
            <CreditPanel
              credit={so.credit}
              title={so.status === "OnHold" ? "Why it's on hold" : "Credit at confirm"}
            />
          ) : null}
          <Card>
            <DefinitionList
              columns={1}
              items={[
                { label: "Place of supply", value: placeOfSupply(so.placeOfSupply) },
                ...(so.releasedByName
                  ? [{ label: "Hold released by", value: so.releasedByName }]
                  : []),
                { label: "Notes", value: so.notes ?? "—" },
              ]}
            />
          </Card>
        </div>
      </div>
      <ConfirmDialog
        open={Boolean(confirm)}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={confirm === "close" ? "Close this order?" : "Cancel this order?"}
        description={
          confirm === "close"
            ? "The undelivered balance is dropped and the order leaves the customer's exposure."
            : "Nothing has been dispatched; the order is cancelled."
        }
        confirmLabel={confirm === "close" ? "Close order" : "Cancel order"}
        tone={confirm === "cancel" ? "danger" : "primary"}
        busy={act.isPending}
        onConfirm={() => confirm && act.mutate({ action: confirm })}
      />
      <ReasonDialog
        open={Boolean(reasonFor)}
        onOpenChange={(o) => !o && setReasonFor(null)}
        title={reasonFor === "release" ? "Release the credit hold?" : "Put this order on hold?"}
        description={
          reasonFor === "release"
            ? `${so.customerName} is ${so.heldReasons.length ? "outside their credit terms" : "on hold"}. Releasing lets the order be dispatched; your name and reason are recorded.`
            : "Nothing can be dispatched until it is released."
        }
        confirmLabel={reasonFor === "release" ? "Release hold" : "Put on hold"}
        busy={act.isPending}
        onConfirm={(reason) => reasonFor && act.mutate({ action: reasonFor, reason })}
      />
    </div>
  );
}

/** FIFO suggestion (ADR-0014): what the godown would pick next. Nothing is held. */
function AllocationCard({ soId }: { soId: string }) {
  const { data } = useQuery(allocationQuery(soId));
  if (!data) return null;
  const lines = data.lines.filter((l) => l.requiredM > 0);
  return (
    <Card
      title="Suggested rolls"
      description="Oldest full rolls first, then remnants; nothing is held until picked."
    >
      {lines.length === 0 ? (
        <EmptyState title="Everything is picked or dispatched" />
      ) : (
        <ul className="grid gap-3 text-sm">
          {lines.map((l) => (
            <li key={l.soLineId} className="grid gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <Badge
                  tone={
                    l.status === "FULFILLED"
                      ? "success"
                      : l.status === "PARTIAL"
                        ? "warning"
                        : "danger"
                  }
                >
                  {l.status === "FULFILLED"
                    ? "Can fill"
                    : l.status === "PARTIAL"
                      ? "Part"
                      : "No stock"}
                </Badge>
                <span>
                  {metres(l.allocatedM)} of {metres(l.requiredM)}
                </span>
                {l.groups.length ? (
                  <span className="text-fg-3">
                    {l.groups
                      .map((g) => `${g.qty} × ${g.lengthM.toLocaleString("en-IN")} m`)
                      .join(" + ")}
                  </span>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {l.rolls.map((r) => (
                  <Mono key={r.rollId} className="rounded bg-muted px-1.5 py-0.5 text-xs">
                    {r.barcode} · {r.lengthM} m
                  </Mono>
                ))}
                {l.cut ? (
                  <Mono className="rounded bg-warning-soft px-1.5 py-0.5 text-xs text-warning">
                    cut {l.cut.cutM} m from {l.cut.barcode}
                  </Mono>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
