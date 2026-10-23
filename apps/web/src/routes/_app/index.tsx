import { fyLabel, istToday } from "@erp/domain";
import { ActivityFeed, Badge, Button, Card, EmptyState, Mono, PageHeader, StatCard } from "@erp/ui";
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import {
  CheckCircle2,
  Circle,
  History,
  Package,
  ShieldAlert,
  Users,
  Warehouse,
} from "lucide-react";
import { dateTime, greeting, longDate } from "../../lib/format.js";
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
};

function DashboardPage() {
  const { data: me } = useQuery(meQuery);
  const series = useQuery({ ...seriesQuery, enabled: can(me, "settings.series.view") });
  const audit = useQuery({ ...auditQuery({}), enabled: can(me, "audit.view") });
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
    { id: "hsn", label: "Add HSN codes to catalogue categories", done: false, to: undefined },
    { id: "customer", label: "Add your first customer", done: false, to: undefined },
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
            <Button
              variant="secondary"
              disabled
              title="Available once Customers are live (Stage 1)"
            >
              Add customer
            </Button>
            <Button variant="primary" disabled title="Available in Stage 3">
              New sales order
            </Button>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Active customers"
          value="0"
          icon={Users}
          hint="Customers arrive with Masters"
        />
        <StatCard
          label="Suppliers"
          value="0"
          icon={Warehouse}
          hint="Add suppliers to start purchasing"
        />
        <StatCard label="Catalogue SKUs" value="0" icon={Package} hint="GSM × quality × width" />
        <StatCard label="Credit-blocked" value="0" icon={ShieldAlert} hint="Customers on hold" />
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
                    Coming in Stage 1
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
