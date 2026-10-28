import { formatINRCompact } from "@erp/domain";
import { Badge, Button, Card, Mono, PageHeader, StatCard, type Tone } from "@erp/ui";
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  BadgeCheck,
  IndianRupee,
  PauseCircle,
  Plus,
  ReceiptText,
  ShieldAlert,
  Truck,
} from "lucide-react";
import type { ReactNode } from "react";
import { dashboardQuery } from "../../../lib/masters.js";
import { can, meQuery } from "../../../lib/queries.js";
import {
  CREDIT_REASON_LABEL,
  dcListQuery,
  irnQueueQuery,
  metres,
  soListQuery,
  rupees,
  count,
} from "../../../lib/sales.js";

export const Route = createFileRoute("/_app/sales/")({ component: SalesBoard });

interface Item {
  id: string;
  to: string;
  params: Record<string, string>;
  no: string;
  who: string;
  meta: ReactNode;
}

/** The Sales Board: what needs someone's attention now (live; SSE refreshes it). */
function SalesBoard() {
  const { data: me } = useQuery(meQuery);
  const { data: dash } = useQuery(dashboardQuery);
  const { data: orders } = useQuery(soListQuery());
  const { data: dcs } = useQuery(dcListQuery({ status: "Open" }));
  const { data: irn } = useQuery(irnQueueQuery);
  const navigate = useNavigate();
  const s = dash?.sales;
  const so = (o: NonNullable<typeof orders>[number], meta: ReactNode): Item => ({
    id: o.id,
    to: "/sales/orders/$soId",
    params: { soId: o.id },
    no: o.soNo,
    who: o.customerName,
    meta,
  });
  const approval = (orders ?? [])
    .filter((o) => o.status === "Draft" && o.pendingApproval)
    .map((o) => so(o, rupees(o.total)));
  const held = (orders ?? [])
    .filter((o) => o.status === "OnHold")
    .map((o) =>
      so(
        o,
        o.heldReasons.length ? (
          o.heldReasons.map((r) => CREDIT_REASON_LABEL[r]).join(" · ")
        ) : (
          <span className="text-fg-3">Held by hand</span>
        ),
      ),
    );
  const toDispatch = (orders ?? [])
    .filter((o) => o.status === "Confirmed" || o.status === "PartiallyFulfilled")
    .map((o) => so(o, `${metres(o.orderedM - o.dispatchedM)} to go`));
  const toInvoice = (dcs ?? [])
    .filter((d) => !d.invoiced)
    .map((d) => ({
      id: d.id,
      to: "/sales/challans/$dcId",
      params: { dcId: d.id },
      no: d.dcNo,
      who: d.customerName,
      meta: `${count(d.rollCount, "roll")} · ${metres(d.metres)}`,
    }));
  const irnItems = (irn ?? []).map((q) => ({
    id: q.id,
    to: q.docType === "SI" ? "/sales/invoices/$siId" : "/sales/notes/$noteId",
    params: (q.docType === "SI" ? { siId: q.id } : { noteId: q.id }) as Record<string, string>,
    no: q.docNo ?? "—",
    who: q.customerName,
    meta: (
      <Badge tone={q.status === "Failed" ? "danger" : q.daysLeft <= 5 ? "warning" : "neutral"}>
        {q.status === "Failed" ? "Rejected" : `${q.daysLeft} days left`}
      </Badge>
    ),
  }));

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Sales Board"
        description="Orders waiting on a manager, credit holds, dispatch and billing — updated live."
        breadcrumbs={[{ label: "Sales" }, { label: "Board" }]}
        actions={
          can(me, "sales.order.manage") ? (
            <Button asChild variant="primary" icon={Plus}>
              <Link to="/sales/orders/new">New order</Link>
            </Button>
          ) : null
        }
      />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Invoiced this month"
          icon={IndianRupee}
          value={s ? formatINRCompact(s.invoicedThisMonth) : "—"}
          hint={s ? count(s.invoicesThisMonth, "invoice") : undefined}
          onClick={() => void navigate({ to: "/sales/invoices" })}
        />
        <StatCard
          label="Open orders"
          icon={Truck}
          value={s?.openOrders ?? "—"}
          hint={s ? `${count(s.challansToInvoice, "challan")} to invoice` : undefined}
          onClick={() => void navigate({ to: "/sales/orders" })}
        />
        <StatCard
          label="On hold for credit"
          icon={PauseCircle}
          value={s?.onHold ?? "—"}
          hint={
            s?.awaitingApproval
              ? `${s.awaitingApproval} awaiting rate approval`
              : "No rates awaiting approval"
          }
          onClick={() => void navigate({ to: "/sales/orders", search: { show: "OnHold" } })}
        />
        <StatCard
          label="IRN pending"
          icon={ShieldAlert}
          value={s ? s.irnPending + s.irnFailed : "—"}
          hint={
            s?.irnFailed ? `${s.irnFailed} rejected — needs a person` : "All reporting normally"
          }
          onClick={() => void navigate({ to: "/sales/irn" })}
        />
      </div>
      <div className="grid gap-6 lg:grid-cols-2 2xl:grid-cols-3">
        <Lane
          title="Awaiting rate approval"
          icon={BadgeCheck}
          tone="warning"
          items={approval}
          empty="No rates waiting."
        />
        <Lane
          title="On hold"
          icon={PauseCircle}
          tone="danger"
          items={held}
          empty="No orders on hold."
        />
        <Lane
          title="To dispatch"
          icon={Truck}
          tone="info"
          items={toDispatch}
          empty="Everything confirmed has gone."
        />
        <Lane
          title="To invoice"
          icon={ReceiptText}
          tone="primary"
          items={toInvoice}
          empty="Every challan is billed."
        />
        <Lane
          title="Waiting for IRN"
          icon={ShieldAlert}
          tone="warning"
          items={irnItems}
          empty="Every invoice has its IRN."
        />
      </div>
    </div>
  );
}

function Lane({
  title,
  icon: Icon,
  tone,
  items,
  empty,
}: {
  title: string;
  icon: typeof Truck;
  tone: Tone;
  items: Item[];
  empty: string;
}) {
  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          <Icon className="size-4 text-fg-2" aria-hidden />
          {title}
        </span>
      }
      actions={<Badge tone={items.length ? tone : "neutral"}>{items.length}</Badge>}
      padded={false}
    >
      {items.length ? (
        <ul className="divide-y divide-border">
          {items.slice(0, 8).map((i) => (
            <li key={i.id}>
              <Link
                to={i.to}
                params={i.params}
                className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm hover:bg-muted focus-visible:bg-muted"
              >
                <span className="grid min-w-0">
                  <span className="truncate font-medium">{i.who}</span>
                  <Mono className="text-xs text-fg-3">{i.no}</Mono>
                </span>
                <span className="shrink-0 text-right text-xs text-fg-2">{i.meta}</span>
              </Link>
            </li>
          ))}
          {items.length > 8 ? (
            <li className="px-4 py-2 text-xs text-fg-3">and {items.length - 8} more</li>
          ) : null}
        </ul>
      ) : (
        <p className="px-4 py-6 text-center text-sm text-fg-3">{empty}</p>
      )}
    </Card>
  );
}
