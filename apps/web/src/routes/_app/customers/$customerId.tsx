import type { CustomerDetail, PartyRateItem } from "@erp/contracts";
import { D, deriveRatePerMetre, formatINR, istToday } from "@erp/domain";
import {
  ActivityFeed,
  Badge,
  Button,
  Card,
  DataTable,
  DefinitionList,
  Dialog,
  EmptyState,
  Field,
  Mono,
  NumberInput,
  PageHeader,
  Select,
  StatCard,
  Switch,
  Tabs,
  TextInput,
  useToast,
} from "@erp/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import {
  Calculator,
  IndianRupee,
  Lock,
  Pencil,
  Plus,
  ShieldCheck,
  Ruler,
  Unlock,
} from "lucide-react";
import { useMemo, useState } from "react";
import { z } from "zod";
import {
  CustomerInvoicesTab,
  CustomerLedgerTab,
  CustomerOrdersTab,
} from "../../../components/customer-sales-tabs.js";
import { ReasonField } from "../../../components/reason-field.js";
import { ApiError, api, call, reasonHeader } from "../../../lib/api.js";
import { useApiErrorToast } from "../../../lib/errors.js";
import { dateTime } from "../../../lib/format.js";
import {
  commissionRulesQuery,
  customerQuery,
  customerRatesQuery,
  flattenIssues,
  productsQuery,
  rateHistoryQuery,
  settingValue,
  stateName,
} from "../../../lib/masters.js";
import { auditQuery, can, keys, meQuery, settingsQuery } from "../../../lib/queries.js";

const TABS = [
  "overview",
  "profile",
  "credit",
  "orders",
  "invoices",
  "ledger",
  "rates",
  "salesman",
  "whatsapp",
  "activity",
] as const;

export const Route = createFileRoute("/_app/customers/$customerId")({
  validateSearch: z.object({ tab: z.enum(TABS).optional() }),
  component: Customer360,
});

const RULE_LABEL = {
  BOTH: "Over limit or overdue",
  OVER_LIMIT: "Over credit limit",
  OVER_DUE: "Overdue past grace",
};

function Customer360() {
  const { customerId } = Route.useParams();
  const { tab = "overview" } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { data: me } = useQuery(meQuery);
  const { data: c, error } = useQuery(customerQuery(customerId));
  const [blocking, setBlocking] = useState(false);

  if (error instanceof ApiError && error.status === 404) {
    return (
      <EmptyState title="Customer not found" hint="It may be outside the customers you can see." />
    );
  }
  if (!c) return null;
  const canCredit = can(me, "customers.credit.manage");
  const blocked = c.creditPolicy.manualBlock;

  return (
    <div className="grid gap-6">
      <PageHeader
        title={c.legalName}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Mono>{c.code}</Mono>
            {c.gstin ? (
              <>
                <span>·</span>
                <Mono>{c.gstin}</Mono>
              </>
            ) : (
              <Badge dot={false}>{c.gstType}</Badge>
            )}
            <span>·</span>
            <span>
              {c.city}, {stateName(c.stateCode)}
            </span>
            {c.groups.map((g) => (
              <Badge key={g.id} tone="primary" dot={false}>
                {g.name}
              </Badge>
            ))}
            {!c.active ? (
              <Badge>Inactive</Badge>
            ) : blocked ? (
              <Badge tone="danger">Blocked</Badge>
            ) : (
              <Badge tone="success">Active</Badge>
            )}
          </span>
        }
        breadcrumbs={[
          { label: "Masters" },
          { label: "Customers", href: "/customers" },
          { label: c.legalName },
        ]}
        renderLink={(crumb, className) => (
          <Link to={crumb.href!} className={className}>
            {crumb.label}
          </Link>
        )}
        actions={
          <>
            {canCredit ? (
              <Button
                variant={blocked ? "secondary" : "danger"}
                icon={blocked ? Unlock : Lock}
                onClick={() => setBlocking(true)}
              >
                {blocked ? "Unblock" : "Block"}
              </Button>
            ) : null}
            {can(me, "customers.manage") ? (
              <Button asChild variant="primary" icon={Pencil}>
                <Link to="/customers/edit/$customerId" params={{ customerId: c.id }}>
                  Edit
                </Link>
              </Button>
            ) : null}
          </>
        }
      />

      {blocked ? (
        <div
          role="status"
          className="flex items-start gap-3 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger"
        >
          <Lock className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p>
            <strong className="font-semibold">On hold:</strong> {c.creditPolicy.blockReason}
            {c.creditPolicy.blockedAt ? ` · since ${dateTime(c.creditPolicy.blockedAt)}` : ""}
            {c.creditPolicy.blockedByName ? ` by ${c.creditPolicy.blockedByName}` : ""}
          </p>
        </div>
      ) : null}

      <Tabs
        value={tab}
        onValueChange={(t) =>
          void navigate({ search: { tab: t as (typeof TABS)[number] }, replace: true })
        }
        tabs={[
          { value: "overview", label: "Overview", content: <OverviewTab c={c} /> },
          {
            value: "profile",
            label: "Profile & contacts",
            count: c.contacts.length,
            content: <ProfileTab c={c} />,
          },
          {
            value: "credit",
            label: "Credit",
            content: <CreditTab key={c.creditPolicy.version} c={c} editable={canCredit} />,
          },
          ...(can(me, "sales.view")
            ? [
                {
                  value: "orders",
                  label: "Orders",
                  content: (
                    <CustomerOrdersTab
                      customerId={c.id}
                      canCreate={can(me, "sales.order.manage")}
                    />
                  ),
                },
                {
                  value: "invoices",
                  label: "Invoices",
                  content: <CustomerInvoicesTab customerId={c.id} />,
                },
                {
                  value: "ledger",
                  label: "Ledger",
                  content: <CustomerLedgerTab customerId={c.id} />,
                },
              ]
            : []),
          {
            value: "rates",
            label: "Rates",
            content: <RatesTab c={c} editable={can(me, "customers.rates.manage")} />,
          },
          {
            value: "salesman",
            label: "Salesman & commission",
            content: <SalesmanTab c={c} canView={can(me, "salesmen.view")} />,
          },
          { value: "whatsapp", label: "WhatsApp", content: <WhatsAppTab c={c} /> },
          {
            value: "activity",
            label: "Activity",
            content: <ActivityTab c={c} canView={can(me, "audit.view")} />,
          },
        ]}
      />

      {blocking ? (
        <BlockDialog key={c.creditPolicy.version} c={c} onClose={() => setBlocking(false)} />
      ) : null}
    </div>
  );
}

function OverviewTab({ c }: { c: CustomerDetail }) {
  return (
    <div className="grid gap-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Credit limit"
          value={formatINR(c.creditPolicy.creditLimit, { decimals: 0 })}
          icon={ShieldCheck}
          hint={`${c.creditPolicy.creditDays} days + ${c.creditPolicy.graceDays} grace`}
        />
        <StatCard
          label="Outstanding"
          value="—"
          icon={IndianRupee}
          hint="Available once invoicing starts (Stage 3)"
        />
        <StatCard
          label="Monthly capacity"
          value={c.monthlyCapacityM ? `${c.monthlyCapacityM.toLocaleString("en-IN")} m` : "—"}
          icon={Ruler}
          hint={
            c.targetSalesM ? `Target ${c.targetSalesM.toLocaleString("en-IN")} m` : "No target set"
          }
        />
        <StatCard
          label="Salesman"
          value={c.salesmanName ?? "—"}
          hint={c.accountManagerName ? `Account manager: ${c.accountManagerName}` : undefined}
        />
      </div>
      <Card title="Summary">
        <DefinitionList
          columns={3}
          items={[
            { label: "Trade name", value: c.tradeName ?? "—" },
            { label: "GST registration", value: c.gstType },
            { label: "PAN", value: c.pan ? <Mono>{c.pan}</Mono> : "—" },
            { label: "Phone", value: c.phone ?? "—" },
            { label: "Email", value: c.email ?? "—" },
            { label: "Business type", value: c.businessType ?? "—" },
            { label: "Cut rolls", value: c.allowCut ? "Accepted" : "Full rolls only" },
            { label: "Customer since", value: dateTime(c.createdAt) },
            { label: "Last updated", value: dateTime(c.updatedAt) },
          ]}
        />
      </Card>
    </div>
  );
}

function ProfileTab({ c }: { c: CustomerDetail }) {
  const addr = (a: CustomerDetail["billingAddress"]) =>
    [a.line1, a.line2, a.city, `${a.state} ${a.pincode}`].filter(Boolean).join(", ");
  return (
    <div className="grid items-start gap-6 lg:grid-cols-2">
      <Card title="Contacts" padded={false}>
        {c.contacts.length ? (
          <ul className="divide-y divide-border">
            {c.contacts.map((x) => (
              <li key={x.id} className="flex items-start justify-between gap-3 px-5 py-3 text-sm">
                <div>
                  <p className="font-medium text-fg">
                    {x.name}{" "}
                    {x.role ? <span className="font-normal text-fg-3">· {x.role}</span> : null}
                  </p>
                  <p className="text-fg-2">
                    {[x.phone, x.email].filter(Boolean).join(" · ") || "—"}
                  </p>
                </div>
                {x.isPrimary ? <Badge tone="primary">Primary</Badge> : null}
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="No contacts" />
        )}
      </Card>
      <Card title="Addresses" padded={false}>
        <ul className="divide-y divide-border text-sm">
          <li className="px-5 py-3">
            <p className="font-medium text-fg">Billing</p>
            <p className="text-fg-2">{addr(c.billingAddress)}</p>
          </li>
          {c.shippingAddresses.map((s) => (
            <li key={s.id} className="flex items-start justify-between gap-3 px-5 py-3">
              <div>
                <p className="font-medium text-fg">{s.label}</p>
                <p className="text-fg-2">{addr(s.address)}</p>
              </div>
              {s.isDefault ? <Badge tone="primary">Default shipping</Badge> : null}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

function CreditTab({ c, editable }: { c: CustomerDetail; editable: boolean }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const onError = useApiErrorToast();
  const p = c.creditPolicy;
  const [editing, setEditing] = useState(false);
  const [limit, setLimit] = useState(p.creditLimit);
  const [days, setDays] = useState(String(p.creditDays));
  const [grace, setGrace] = useState(String(p.graceDays));
  const [rule, setRule] = useState(p.blockRule);
  const [auto, setAuto] = useState(p.autoBlock);
  const [reason, setReason] = useState("");
  const save = useMutation({
    mutationFn: () =>
      call(() =>
        api.PUT("/api/customers/{id}/credit-policy", {
          params: { path: { id: c.id } },
          headers: reasonHeader(reason),
          body: {
            creditLimit: limit,
            creditDays: Number(days),
            graceDays: Number(grace),
            blockRule: rule,
            autoBlock: auto,
            version: p.version,
          },
        }),
      ),
    onSuccess: async () => {
      toast({ tone: "success", title: "Credit policy updated" });
      setEditing(false);
      await queryClient.invalidateQueries({ queryKey: keys.customers });
    },
    onError: (e) => onError(e, keys.customers),
  });

  return (
    <Card
      title="Credit policy"
      description="Exposure and overdue checks start with sales orders and invoices (Stages 3–4)."
      actions={
        editable ? (
          <Button size="sm" variant="secondary" icon={Pencil} onClick={() => setEditing(true)}>
            Change
          </Button>
        ) : null
      }
    >
      <DefinitionList
        columns={3}
        items={[
          {
            label: "Credit limit",
            value: <span className="tnum">{formatINR(p.creditLimit)}</span>,
          },
          { label: "Credit days", value: `${p.creditDays} days` },
          { label: "Grace days (internal)", value: `${p.graceDays} days` },
          { label: "Block when", value: RULE_LABEL[p.blockRule] },
          { label: "Automatic block", value: p.autoBlock ? "On" : "Off" },
          {
            label: "Manual hold",
            value: p.manualBlock ? (
              <Badge tone="danger">Blocked</Badge>
            ) : (
              <Badge tone="success">None</Badge>
            ),
          },
        ]}
      />
      {editing ? (
        <Dialog
          open
          onOpenChange={(o) => !o && setEditing(false)}
          title="Change credit policy"
          description="You may be asked to confirm your password. The reason is kept in the audit log."
          footer={
            <>
              <Button variant="secondary" onClick={() => setEditing(false)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                disabled={!reason.trim()}
                busy={save.isPending}
                onClick={() => save.mutate()}
              >
                Save policy
              </Button>
            </>
          }
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Credit limit">
              {(f) => (
                <NumberInput
                  {...f}
                  decimals={2}
                  prefix="₹"
                  value={limit}
                  onValueChange={setLimit}
                />
              )}
            </Field>
            <Field label="Credit days">
              {(f) => (
                <NumberInput
                  {...f}
                  decimals={0}
                  suffix="days"
                  value={days}
                  onValueChange={setDays}
                />
              )}
            </Field>
            <Field label="Grace days">
              {(f) => (
                <NumberInput
                  {...f}
                  decimals={0}
                  suffix="days"
                  value={grace}
                  onValueChange={setGrace}
                />
              )}
            </Field>
            <Field label="Block when">
              {(f) => (
                <Select
                  {...f}
                  value={rule}
                  onValueChange={(v) => setRule(v as typeof rule)}
                  options={Object.entries(RULE_LABEL).map(([value, label]) => ({ value, label }))}
                />
              )}
            </Field>
            <div className="sm:col-span-2">
              <Switch label="Block automatically" checked={auto} onCheckedChange={setAuto} />
            </div>
            <div className="sm:col-span-2">
              <ReasonField value={reason} onChange={setReason} required />
            </div>
          </div>
        </Dialog>
      ) : null}
    </Card>
  );
}

function BlockDialog({ c, onClose }: { c: CustomerDetail; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const onError = useApiErrorToast();
  const [reason, setReason] = useState("");
  const blocking = !c.creditPolicy.manualBlock;
  const save = useMutation({
    mutationFn: () =>
      call(() =>
        api.POST("/api/customers/{id}/block", {
          params: { path: { id: c.id } },
          headers: reasonHeader(reason),
          body: { blocked: blocking, version: c.creditPolicy.version },
        }),
      ),
    onSuccess: async () => {
      toast({
        tone: blocking ? "warning" : "success",
        title: blocking ? `${c.legalName} blocked` : `${c.legalName} unblocked`,
      });
      await queryClient.invalidateQueries({ queryKey: keys.customers });
      await queryClient.invalidateQueries({ queryKey: keys.dashboard });
      onClose();
    },
    onError: (e) => onError(e, keys.customers),
  });
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={blocking ? "Block this customer?" : "Unblock this customer?"}
      description={
        blocking
          ? "New orders and dispatches stop until someone unblocks them."
          : "Orders can be placed again, subject to the credit policy."
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant={blocking ? "danger" : "primary"}
            disabled={!reason.trim()}
            busy={save.isPending}
            onClick={() => save.mutate()}
          >
            {blocking ? "Block customer" : "Unblock customer"}
          </Button>
        </>
      }
    >
      <ReasonField value={reason} onChange={setReason} required />
    </Dialog>
  );
}

function RatesTab({ c, editable }: { c: CustomerDetail; editable: boolean }) {
  const { data: rates, isLoading } = useQuery(customerRatesQuery(c.id));
  const { data: history } = useQuery(rateHistoryQuery(c.id));
  const [adding, setAdding] = useState<{ productId?: string } | null>(null);
  const [showAll, setShowAll] = useState(false);
  const visible = (rates ?? []).filter((r) => showAll || r.current || r.validFrom > istToday());

  const columns: ColumnDef<PartyRateItem, unknown>[] = [
    {
      accessorKey: "productName",
      header: "Product",
      cell: (x) => <span className="font-medium">{x.getValue() as string}</span>,
    },
    {
      accessorKey: "baseRate44",
      header: "₹/m at 44″",
      meta: { numeric: true },
      cell: (x) => formatINR(x.getValue() as string),
    },
    {
      id: "validity",
      header: "Valid",
      accessorFn: (r) => `${r.validFrom} → ${r.validTo ?? "open"}`,
    },
    {
      accessorKey: "source",
      header: "Source",
      cell: (x) =>
        ({
          manual: "Manual",
          bulk_revision: "Bulk revision",
          salesman_default: "Salesman default",
        })[x.getValue() as PartyRateItem["source"]],
    },
    {
      id: "state",
      header: "",
      cell: (x) =>
        x.row.original.current ? (
          <Badge tone="success">Current</Badge>
        ) : x.row.original.validFrom > istToday() ? (
          <Badge tone="info">Upcoming</Badge>
        ) : (
          <Badge>Past</Badge>
        ),
    },
    ...(editable
      ? [
          {
            id: "actions",
            header: "",
            cell: (x: { row: { original: PartyRateItem } }) =>
              x.row.original.current ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setAdding({ productId: x.row.original.productId })}
                >
                  Revise
                </Button>
              ) : null,
          } satisfies ColumnDef<PartyRateItem, unknown>,
        ]
      : []),
  ];

  return (
    <div className="grid gap-6">
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Card
          title="Rates"
          description="Per metre at the 44″ benchmark. Revising closes the running rate the day before the new one starts."
          padded={false}
          actions={
            <div className="flex items-center gap-3">
              <Switch label="Show past" checked={showAll} onCheckedChange={setShowAll} />
              {editable ? (
                <Button size="sm" variant="primary" icon={Plus} onClick={() => setAdding({})}>
                  Set rate
                </Button>
              ) : null}
            </div>
          }
        >
          <DataTable
            caption="Customer rates"
            data={visible}
            loading={isLoading}
            columns={columns}
            getRowId={(r) => r.id}
            pageSize={false}
            empty={
              <EmptyState
                title="No rates yet"
                hint="Set a rate per product, or bring them in from a salesman's defaults."
              />
            }
          />
        </Card>
        <WidthCalculator rates={rates ?? []} />
      </div>
      <Card title="Rate history" padded={false}>
        {history?.length ? (
          <ul className="divide-y divide-border text-sm">
            {history.map((h) => (
              <li
                key={h.id}
                className="flex flex-wrap items-baseline justify-between gap-2 px-5 py-2.5"
              >
                <span>
                  <span className="font-medium text-fg">{h.productName}</span>{" "}
                  <span className="tnum text-fg-2">
                    {h.previousRate44 ? `₹${h.previousRate44} → ` : ""}₹{h.newRate44}
                  </span>{" "}
                  <span className="text-fg-3">from {h.validFrom}</span>
                  {h.reason ? <span className="text-fg-3"> · {h.reason}</span> : null}
                </span>
                <span className="text-xs text-fg-3">
                  {h.byName ?? "System"} · {dateTime(h.at)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="No changes yet" />
        )}
      </Card>
      {adding ? (
        <RateDialog c={c} productId={adding.productId} onClose={() => setAdding(null)} />
      ) : null}
    </div>
  );
}

/** 44″ calculator: derived ₹/m for every allowed width (ADR-0013, Q6: 2 decimals). */
function WidthCalculator({ rates }: { rates: PartyRateItem[] }) {
  const { data: settings } = useQuery(settingsQuery);
  const widths = settingValue<number[]>(
    settings,
    "catalogue.allowedWidthsIn",
    [24, 36, 40, 44, 46, 48, 50, 60, 63],
  );
  const decimals = settingValue<number>(settings, "pricing.rateDecimals", 2);
  const current = rates.filter((r) => r.current);
  const [productId, setProductId] = useState<string>("manual");
  const [manual, setManual] = useState("20");
  const base =
    productId === "manual"
      ? manual
      : (current.find((r) => r.productId === productId)?.baseRate44 ?? "0");
  const derived = useMemo(() => {
    try {
      return widths.map((w) => ({
        w,
        rate: deriveRatePerMetre(base || "0", w, decimals).toFixed(decimals),
      }));
    } catch {
      return [];
    }
  }, [base, widths, decimals]);
  return (
    <Card title="44″ calculator" actions={<Calculator className="size-4 text-fg-3" aria-hidden />}>
      <div className="grid gap-3">
        <Field label="Base rate from">
          {(p) => (
            <Select
              {...p}
              value={productId}
              onValueChange={setProductId}
              options={[
                { value: "manual", label: "Enter a rate" },
                ...current.map((r) => ({ value: r.productId, label: r.productName })),
              ]}
            />
          )}
        </Field>
        {productId === "manual" ? (
          <Field label="₹/m at 44″">
            {(p) => (
              <NumberInput
                {...p}
                decimals={4}
                prefix="₹"
                value={manual}
                onValueChange={setManual}
              />
            )}
          </Field>
        ) : null}
        <table className="w-full text-sm">
          <caption className="sr-only">Derived rates by width</caption>
          <thead>
            <tr className="text-left text-xs text-fg-3">
              <th scope="col" className="py-1 font-medium">
                Width
              </th>
              <th scope="col" className="py-1 text-right font-medium">
                ₹ per metre
              </th>
            </tr>
          </thead>
          <tbody>
            {derived.map((d) => (
              <tr key={d.w} className="border-t border-border">
                <td className="tnum py-1.5">
                  {d.w}″{d.w === 44 ? <span className="ml-1 text-xs text-fg-3">base</span> : null}
                </td>
                <td className="tnum py-1.5 text-right font-medium">
                  {formatINR(d.rate, { decimals })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function RateDialog({
  c,
  productId: initialProduct,
  onClose,
}: {
  c: CustomerDetail;
  productId?: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const onError = useApiErrorToast();
  const { data: products } = useQuery(productsQuery);
  const [productId, setProductId] = useState(initialProduct ?? "");
  const [rate, setRate] = useState("");
  const [from, setFrom] = useState(istToday());
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: () =>
      call(() =>
        api.POST("/api/customers/{id}/rates", {
          params: { path: { id: c.id } },
          headers: reasonHeader(reason),
          body: { productId, baseRate44: rate, validFrom: from, mode: "revise" },
        }),
      ),
    onSuccess: async () => {
      toast({
        tone: "success",
        title: "Rate saved",
        description: `₹${rate}/m at 44″ from ${from}`,
      });
      await queryClient.invalidateQueries({ queryKey: keys.customers });
      onClose();
    },
    onError: (e) => {
      if (e instanceof ApiError) setErrors(flattenIssues(e.fieldErrors()));
      onError(e);
    },
  });
  const valid = productId && rate && D(rate).greaterThan(0);
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Set rate"
      description="Per metre at 44″. Any rate running on that date ends the day before."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!valid}
            busy={save.isPending}
            onClick={() => save.mutate()}
          >
            Save rate
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Product" required className="sm:col-span-2" error={errors.productId}>
          {(p) => (
            <Select
              {...p}
              value={productId || undefined}
              onValueChange={setProductId}
              placeholder="Choose a product"
              options={(products ?? [])
                .filter((x) => x.active)
                .map((x) => ({ value: x.id, label: x.name }))}
            />
          )}
        </Field>
        <Field label="₹/m at 44″" required error={errors.baseRate44}>
          {(p) => (
            <NumberInput
              {...p}
              autoFocus
              decimals={4}
              prefix="₹"
              value={rate}
              onValueChange={setRate}
            />
          )}
        </Field>
        <Field label="Valid from" required error={errors.validFrom}>
          {(p) => (
            <TextInput {...p} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          )}
        </Field>
        <div className="sm:col-span-2">
          <ReasonField value={reason} onChange={setReason} />
        </div>
      </div>
    </Dialog>
  );
}

function SalesmanTab({ c, canView }: { c: CustomerDetail; canView: boolean }) {
  const { data: rules } = useQuery({
    ...commissionRulesQuery(c.salesmanId ?? "none"),
    enabled: canView && Boolean(c.salesmanId),
  });
  if (!c.salesmanId) return <EmptyState title="No salesman" hint="Assign one from Edit." />;
  const mine = (rules ?? []).filter((r) => r.customerId === c.id);
  return (
    <Card
      title={c.salesmanName ?? "Salesman"}
      actions={
        canView ? (
          <Button asChild size="sm" variant="secondary">
            <Link
              to="/salesmen/$salesmanId"
              params={{ salesmanId: c.salesmanId }}
              search={{ tab: "customers" }}
            >
              Open salesman
            </Link>
          </Button>
        ) : null
      }
    >
      {mine.length ? (
        <ul className="divide-y divide-border text-sm">
          {mine.map((r) => (
            <li key={r.id} className="flex justify-between gap-3 py-2.5">
              <span>
                {r.method === "PER_METER" ? `₹${r.rate} per metre` : `${r.rate}% of taxable value`}{" "}
                · {r.triggerEvent === "ON_SI_POSTED" ? "on invoice" : "on payment"}
              </span>
              <span className="text-fg-3">
                {r.validFrom} → {r.validTo ?? "open"}{" "}
                {r.current ? <Badge tone="success">Current</Badge> : null}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-fg-3">No commission rule for this customer.</p>
      )}
    </Card>
  );
}

function WhatsAppTab({ c }: { c: CustomerDetail }) {
  return (
    <Card
      title="WhatsApp"
      description="Order and payment messages arrive in a later stage. Consent is captured now."
    >
      <DefinitionList
        columns={3}
        items={[
          { label: "Number", value: c.whatsappNumber ?? "—" },
          { label: "Language", value: c.whatsappLanguage },
          {
            label: "Consent",
            value: c.whatsappConsent ? (
              <span>
                <Badge tone="success">Given</Badge>{" "}
                <span className="text-xs text-fg-3">{dateTime(c.whatsappConsentAt)}</span>
              </span>
            ) : (
              <Badge tone="warning">Not recorded</Badge>
            ),
          },
        ]}
      />
    </Card>
  );
}

function ActivityTab({ c, canView }: { c: CustomerDetail; canView: boolean }) {
  const { data } = useQuery({
    ...auditQuery({ table: "customers", rowId: c.id }),
    enabled: canView,
  });
  if (!canView)
    return (
      <EmptyState title="Audit access needed" hint="Ask an admin for the audit log permission." />
    );
  const entries = (data?.items ?? []).map((i) => ({
    id: String(i.id),
    who: i.userName ?? "System",
    what: (
      <>
        {i.action === "INSERT"
          ? "created the customer"
          : `changed ${(i.changedKeys ?? []).filter((k) => !["version", "updated_at", "updated_by"].includes(k)).join(", ") || "the record"}`}
        {i.reason ? <span className="text-fg-3"> — “{i.reason}”</span> : null}
      </>
    ),
    when: dateTime(i.at),
  }));
  return (
    <Card title="Activity">
      {entries.length ? <ActivityFeed entries={entries} /> : <EmptyState title="No activity yet" />}
    </Card>
  );
}
