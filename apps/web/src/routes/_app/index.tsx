import { formatINRCompact, fyLabel, istToday } from "@erp/domain";
import { ActivityFeed, Badge, Button, Card, EmptyState, Mono, PageHeader, StatCard } from "@erp/ui";
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  CheckCircle2,
  Circle,
  CalendarClock,
  HandCoins,
  History,
  IndianRupee,
  Package,
  PauseCircle,
  ShieldAlert,
  ShieldCheck,
  Truck,
  Users,
  Wallet,
  Warehouse,
} from "lucide-react";
import { dateTime, greeting, longDate } from "../../lib/format.js";
import { dashboardQuery } from "../../lib/masters.js";
import { count } from "../../lib/sales.js";
import { auditQuery, can, meQuery, seriesQuery } from "../../lib/queries.js";

export const Route = createFileRoute("/_app/")({ component: DashboardPage });

const TABLE_LABELS: Record<string, string> = {
  settings: "a setting",
  companies: "the company profile",
  document_series: "a document series",
  user: "a user",
  user_roles: "role assignments",
  role_permissions: "permissions",
  roles: "a role",
  customers: "a customer",
  credit_policies: "a credit policy",
  party_rates: "customer rates",
  suppliers: "a supplier",
  transporters: "a transporter",
  salesmen: "a salesman",
  categories: "a catalogue category",
  products: "a product",
  skus: "a SKU",
};

function DashboardPage() {
  const { data: me } = useQuery(meQuery);
  const series = useQuery({ ...seriesQuery, enabled: can(me, "settings.series.view") });
  const audit = useQuery({ ...auditQuery({}), enabled: can(me, "audit.view") });
  const summary = useQuery(dashboardQuery).data;
  const navigate = useNavigate();
  if (!me) return null;

  const firstName = me.user.name.split(" ")[0];
  const nextInvoice = series.data?.find((s) => s.entityType === "SI")?.nextNumber;
  const seriesReviewed = Boolean(series.data?.some((s) => s.updatedByName));

  const checklist = [
    {
      id: "company",
      label: "Complete the company GST profile",
      done: !me.company.isPlaceholder,
      to: "/settings/company",
    },
    {
      id: "2fa",
      label: "Turn on two-step verification",
      done: me.user.twoFactorEnabled,
      to: "/setup-2fa",
    },
    {
      id: "series",
      label: "Review document numbering",
      done: seriesReviewed,
      to: "/settings/series",
    },
    {
      id: "hsn",
      label: "Add HSN codes to catalogue categories",
      done: summary ? summary.categoriesMissingTax === 0 : false,
      to: "/catalogue",
    },
    {
      id: "customer",
      label: "Add your first customer",
      done: (summary?.activeCustomers ?? 0) > 0,
      to: "/customers/new",
    },
  ];
  const doneCount = checklist.filter((c) => c.done).length;

  const activity = (audit.data?.items ?? []).slice(0, 6).map((item) => ({
    id: String(item.id),
    who: item.userName ?? "System",
    what: (
      <>
        {item.action === "INSERT" ? "created" : item.action === "DELETE" ? "removed" : "updated"}{" "}
        {TABLE_LABELS[item.tableName] ?? item.tableName}
        {item.rowId && item.tableName === "settings" ? (
          <>
            {" "}
            <Mono className="text-fg-2">{item.rowId}</Mono>
          </>
        ) : null}
      </>
    ),
    when: dateTime(item.at),
  }));

  return (
    <div className="grid gap-6">
      <PageHeader
        title={`${greeting()}, ${firstName}`}
        description={`${longDate()} · Financial year ${fyLabel(istToday())}`}
        actions={
          <>
            {can(me, "customers.manage") ? (
              <Button asChild variant="secondary">
                <Link to="/customers/new">Add customer</Link>
              </Button>
            ) : null}
            {can(me, "sales.order.manage") ? (
              <Button asChild variant="primary">
                <Link to="/sales/orders/new">New sales order</Link>
              </Button>
            ) : null}
          </>
        }
      />

      {summary?.sales ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Invoiced this month"
            value={formatINRCompact(summary.sales.invoicedThisMonth)}
            icon={IndianRupee}
            hint={count(summary.sales.invoicesThisMonth, "invoice")}
            onClick={() => void navigate({ to: "/sales/invoices" })}
          />
          <StatCard
            label="Open orders"
            value={fmt(summary.sales.openOrders)}
            icon={Truck}
            hint={`${count(summary.sales.challansToInvoice, "challan")} to invoice`}
            onClick={() => void navigate({ to: "/sales/orders" })}
          />
          <StatCard
            label="Orders on hold"
            value={fmt(summary.sales.onHold)}
            icon={PauseCircle}
            hint={
              summary.sales.awaitingApproval
                ? `${summary.sales.awaitingApproval} awaiting rate approval`
                : "Credit holds"
            }
            onClick={() => void navigate({ to: "/sales" })}
          />
          <StatCard
            label="IRN pending"
            value={fmt(summary.sales.irnPending + summary.sales.irnFailed)}
            icon={ShieldCheck}
            hint={
              summary.sales.irnFailed
                ? `${summary.sales.irnFailed} rejected`
                : "E-invoices to report"
            }
            onClick={() => void navigate({ to: "/sales/irn" })}
          />
        </div>
      ) : null}

      {summary?.collections ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Collected this month"
            value={formatINRCompact(summary.collections.collectedThisMonth)}
            icon={HandCoins}
            hint={`${formatINRCompact(summary.collections.collectedToday)} today`}
            onClick={() =>
              void navigate({ to: "/collections/$kind", params: { kind: "receipts" } })
            }
          />
          <StatCard
            label="Receivable"
            value={formatINRCompact(summary.collections.receivable)}
            icon={Wallet}
            hint={
              Number(summary.collections.onAccount)
                ? `${formatINRCompact(summary.collections.onAccount)} on account`
                : "Owed by customers"
            }
            onClick={() => void navigate({ to: "/collections/aging" })}
          />
          <StatCard
            label="Overdue"
            value={formatINRCompact(summary.collections.overdue)}
            icon={CalendarClock}
            hint="Past the due date"
            onClick={() => void navigate({ to: "/collections/aging" })}
          />
          <StatCard
            label="Blocked orders"
            value={fmt(summary.sales?.onHold)}
            icon={PauseCircle}
            hint="Held for credit or by hand"
            onClick={() => void navigate({ to: "/collections/blocked" })}
          />
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Active customers"
          value={fmt(summary?.activeCustomers)}
          icon={Users}
          hint={
            summary ? `${formatINRCompact(summary.totalCreditLimit)} total credit limit` : undefined
          }
        />
        <StatCard
          label="Suppliers"
          value={fmt(summary?.suppliers)}
          icon={Warehouse}
          hint="Active suppliers"
        />
        <StatCard
          label="Catalogue SKUs"
          value={fmt(summary?.skus)}
          icon={Package}
          hint={
            summary?.categoriesMissingTax
              ? `${summary.categoriesMissingTax} categories need HSN`
              : "GSM × quality × width"
          }
        />
        <StatCard
          label="Credit-blocked"
          value={fmt(summary?.blockedCustomers)}
          icon={ShieldAlert}
          hint="Customers on hold"
        />
      </div>

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Card
          title="Setup checklist"
          description={`${doneCount} of ${checklist.length} complete`}
          actions={
            <Badge tone={doneCount === checklist.length ? "success" : "warning"}>
              {Math.round((doneCount / checklist.length) * 100)}%
            </Badge>
          }
          padded={false}
        >
          <div className="h-1.5 bg-muted" aria-hidden>
            <div
              className="h-full bg-primary transition-all"
              style={{ width: `${(doneCount / checklist.length) * 100}%` }}
            />
          </div>
          <ul>
            {checklist.map((item) => (
              <li
                key={item.id}
                className="flex items-center gap-3 border-b border-border px-5 py-3.5 last:border-b-0"
              >
                {item.done ? (
                  <CheckCircle2 className="size-5 shrink-0 text-success" aria-label="Done" />
                ) : (
                  <Circle className="size-5 shrink-0 text-border-strong" aria-label="To do" />
                )}
                <span
                  className={
                    item.done
                      ? "flex-1 text-sm text-fg-3 line-through"
                      : "flex-1 text-sm font-medium text-fg"
                  }
                >
                  {item.label}
                </span>
                {!item.done && item.to ? (
                  <Button asChild size="sm" variant="secondary">
                    <Link to={item.to}>Open</Link>
                  </Button>
                ) : !item.done ? (
                  <Badge tone="neutral" dot={false}>
                    Coming soon
                  </Badge>
                ) : null}
              </li>
            ))}
          </ul>
        </Card>

        <div className="grid content-start gap-6">
          <Card title="At a glance" padded>
            <dl className="grid gap-4 text-sm">
              <div className="flex items-center justify-between gap-4">
                <dt className="text-fg-2">Financial year</dt>
                <dd className="font-medium text-fg">{fyLabel(istToday())}</dd>
              </div>
              {nextInvoice ? (
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-fg-2">Next sales invoice</dt>
                  <dd>
                    <Mono className="font-medium text-fg">{nextInvoice}</Mono>
                  </dd>
                </div>
              ) : null}
              <div className="flex items-center justify-between gap-4">
                <dt className="text-fg-2">Company profile</dt>
                <dd>
                  {me.company.isPlaceholder ? (
                    <Badge tone="warning">Incomplete</Badge>
                  ) : (
                    <Badge tone="success">Complete</Badge>
                  )}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt className="text-fg-2">Two-step verification</dt>
                <dd>
                  {me.user.twoFactorEnabled ? (
                    <Badge tone="success">On</Badge>
                  ) : (
                    <Badge tone="warning">Off</Badge>
                  )}
                </dd>
              </div>
            </dl>
          </Card>

          {can(me, "audit.view") ? (
            <Card
              title="Recent activity"
              actions={
                <Button asChild size="sm" variant="ghost">
                  <Link to="/settings/audit">View all</Link>
                </Button>
              }
            >
              {activity.length ? (
                <ActivityFeed entries={activity} />
              ) : (
                <EmptyState
                  icon={History}
                  title="No activity yet"
                  hint="Changes made by your team will show up here."
                />
              )}
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}

const fmt = (n: number | undefined) => (n === undefined ? "—" : n.toLocaleString("en-IN"));
