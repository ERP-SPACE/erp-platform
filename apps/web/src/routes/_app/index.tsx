import type { TodayResponse } from "@erp/contracts";
import { formatINRCompact, fyLabel, istToday } from "@erp/domain";
import { ActivityFeed, Badge, Button, Card, EmptyState, Mono, PageHeader, StatCard } from "@erp/ui";
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  CheckCircle2,
  ChevronRight,
  Circle,
  FileText,
  HandCoins,
  History,
  PackageSearch,
  PauseCircle,
  ShoppingBag,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import { AgingWaterfall, SalesTrendChart, StockHeatmap } from "../../components/charts.js";
import { dateTime, greeting, longDate } from "../../lib/format.js";
import { dashboardQuery } from "../../lib/masters.js";
import { auditQuery, can, meQuery, seriesQuery } from "../../lib/queries.js";
import { asOfLabel, todayQuery } from "../../lib/reports.js";
import { count, rupees } from "../../lib/sales.js";

export const Route = createFileRoute("/_app/")({ component: TodayPage });

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
  sales_orders: "a sales order",
  sales_invoices: "a sales invoice",
  delivery_challans: "a challan",
  customer_notes: "a credit / debit note",
  receipts: "a receipt or payment",
  purchase_orders: "a purchase order",
  goods_receipts: "a GRN",
  purchase_invoices: "a purchase invoice",
  saved_pivots: "a saved pivot",
};

const hours = (h: number) =>
  h < 1 ? "just now" : h < 48 ? `${Math.floor(h)} h` : `${Math.floor(h / 24)} days`;

/**
 * Today (PRD §9.7, brief §B4.1, ADR-0022 layout): one sentence on the day, the KPIs, what needs
 * the user, then the 30-day sales line, AR aging and the stock heatmap — filtered by role.
 * The setup checklist stays until the basics are done.
 */
function TodayPage() {
  const { data: me } = useQuery(meQuery);
  const today = useQuery({ ...todayQuery, enabled: can(me, "reports.view") });
  const series = useQuery({ ...seriesQuery, enabled: can(me, "settings.series.view") });
  const audit = useQuery({ ...auditQuery({}), enabled: can(me, "audit.view") });
  const summary = useQuery(dashboardQuery).data;
  const navigate = useNavigate();
  if (!me) return null;
  const t = today.data;

  const firstName = me.user.name.split(" ")[0];
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
        description={`${longDate()} · ${t ? `${asOfLabel(t.asOf)} · ` : ""}Financial year ${fyLabel(istToday())}`}
        actions={
          <>
            {can(me, "reports.view") ? (
              <Button asChild variant="secondary">
                <Link to="/reports">Reports</Link>
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

      {t?.sentence ? (
        <p className="max-w-4xl text-base leading-relaxed text-fg" data-testid="today-sentence">
          {t.sentence}
        </p>
      ) : null}

      {t ? <Kpis t={t} onOpen={(to) => void navigate({ to })} /> : null}

      {t ? (
        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
          <NeedsYou items={t.needsYou} />
          {t.charts.salesTrend ? (
            <Card
              title="Sales, last 30 days"
              description="Taxable value invoiced, net of credit notes"
              actions={
                <Button asChild size="sm" variant="ghost">
                  <Link
                    to="/reports/$reportId"
                    params={{ reportId: "sales-trend" }}
                    search={{ grain: "day" }}
                  >
                    Open report
                  </Link>
                </Button>
              }
            >
              <SalesTrendChart data={t.charts.salesTrend} />
            </Card>
          ) : null}
        </div>
      ) : null}

      {t && (t.charts.arAging || t.charts.stockHeatmap) ? (
        <div className="grid items-start gap-6 xl:grid-cols-2">
          {t.charts.arAging ? (
            <Card
              title="Receivables by age"
              description="Days since the invoice date; each bar starts where the younger ones end"
              actions={
                <Button asChild size="sm" variant="ghost">
                  <Link to="/collections/aging">Aging</Link>
                </Button>
              }
            >
              <AgingWaterfall data={t.charts.arAging} />
            </Card>
          ) : null}
          {t.charts.stockHeatmap ? (
            <Card
              title="Stock aging"
              description="Metres in hand by GSM and width; deeper shade = older stock"
              actions={
                <Button asChild size="sm" variant="ghost">
                  <Link to="/reports/$reportId" params={{ reportId: "batch-aging" }}>
                    Batch aging
                  </Link>
                </Button>
              }
            >
              {t.charts.stockHeatmap.length ? (
                <StockHeatmap data={t.charts.stockHeatmap} />
              ) : (
                <EmptyState
                  icon={PackageSearch}
                  title="No stock in hand"
                  hint="Rolls appear here once a GRN is posted."
                />
              )}
            </Card>
          ) : null}
        </div>
      ) : null}

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        {doneCount < checklist.length ? (
          <Card
            title="Setup checklist"
            description={`${doneCount} of ${checklist.length} complete`}
            actions={
              <Badge tone="warning">{Math.round((doneCount / checklist.length) * 100)}%</Badge>
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
                  {!item.done ? (
                    <Button asChild size="sm" variant="secondary">
                      <Link to={item.to}>Open</Link>
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          </Card>
        ) : null}
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
                title="Nothing yet"
                hint="Changes people make appear here."
              />
            )}
          </Card>
        ) : null}
      </div>
    </div>
  );
}

function Kpis({ t, onOpen }: { t: TodayResponse; onOpen: (to: string) => void }) {
  const k = t.kpis;
  const cards = [
    k.ordersToday && {
      label: "Orders today",
      value: formatINRCompact(k.ordersToday.value),
      hint: count(k.ordersToday.count, "order"),
      icon: ShoppingBag,
      to: "/sales/orders",
    },
    k.invoicesToday && {
      label: "Invoiced today",
      value: formatINRCompact(k.invoicesToday.value),
      hint: count(k.invoicesToday.count, "invoice"),
      icon: FileText,
      to: "/sales/invoices",
    },
    k.collectionsToday && {
      label: "Collected today",
      value: formatINRCompact(k.collectionsToday.value),
      hint: count(k.collectionsToday.count, "receipt"),
      icon: HandCoins,
      to: "/collections/receipts",
    },
    k.creditBlocks && {
      label: "Credit holds",
      value: k.creditBlocks.count.toLocaleString("en-IN"),
      hint: `${formatINRCompact(k.creditBlocks.exposure)} held`,
      icon: PauseCircle,
      to: "/collections/blocked",
    },
    k.unmappedRolls && {
      label: "Unmapped rolls",
      value: k.unmappedRolls.count.toLocaleString("en-IN"),
      hint: k.unmappedRolls.olderThanAlert
        ? `${k.unmappedRolls.olderThanAlert} waiting over a day`
        : "None waiting long",
      icon: PackageSearch,
      to: "/inventory/unmapped",
    },
    k.grossMargin && {
      label: "Gross margin, this month",
      value: formatINRCompact(k.grossMargin.value),
      hint: k.grossMargin.percent ? `${k.grossMargin.percent} % of sales` : "No sales yet",
      icon: TrendingUp,
      to: "/reports/gross-margin",
    },
  ].filter(Boolean) as {
    label: string;
    value: string;
    hint: string;
    icon: LucideIcon;
    to: string;
  }[];
  if (!cards.length) return null;
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
      {cards.map((c) => (
        <StatCard
          key={c.label}
          label={c.label}
          value={c.value}
          hint={c.hint}
          icon={c.icon}
          onClick={() => onOpen(c.to)}
        />
      ))}
    </div>
  );
}

function NeedsYou({ items }: { items: TodayResponse["needsYou"] }) {
  return (
    <Card
      title="Needs you"
      description={items.length ? "Most urgent first" : undefined}
      padded={false}
    >
      {items.length ? (
        <ul>
          {items.map((n) => (
            <li key={n.kind} className="border-b border-border last:border-b-0">
              <Link
                to={n.href}
                className="flex items-center gap-3 px-5 py-3 text-sm hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
              >
                <span className="tnum inline-flex min-w-8 justify-center rounded-md bg-primary-soft px-2 py-0.5 text-sm font-semibold text-primary">
                  {n.count}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-medium text-fg">{n.label}</span>
                  <span className="block text-xs text-fg-2">
                    {n.amount ? `${rupees(n.amount)} · ` : ""}oldest {hours(n.oldestHours)}
                  </span>
                </span>
                <ChevronRight className="size-4 text-fg-3" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <div className="p-5">
          <EmptyState
            icon={CheckCircle2}
            title="All clear"
            hint="Nothing is waiting on you right now."
          />
        </div>
      )}
    </Card>
  );
}
