import type { CustomerListItem } from "@erp/contracts";
import { D, formatINR, formatINRCompact } from "@erp/domain";
import { Badge, Button, DataTable, Mono, PageHeader, Select, StatCard } from "@erp/ui";
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import type { ColumnDef } from "@tanstack/react-table";
import { Percent, Plus, ShieldAlert, TrendingUp, UserCheck, Users, Wallet } from "lucide-react";
import { useEffect, useMemo } from "react";
import { z } from "zod";
import {
  customerGroupsQuery,
  customersQuery,
  salesmenQuery,
  stateName,
} from "../../../lib/masters.js";
import { can, meQuery } from "../../../lib/queries.js";

export const Route = createFileRoute("/_app/customers/")({
  validateSearch: z.object({
    q: z.string().optional(),
    group: z.string().optional(),
    salesman: z.string().optional(),
    status: z.enum(["active", "blocked", "inactive", "all"]).optional(),
  }),
  component: CustomersPage,
});

const columns: ColumnDef<CustomerListItem, unknown>[] = [
  {
    accessorKey: "code",
    header: "Code",
    cell: (c) => <Mono>{c.getValue() as string}</Mono>,
    meta: { width: "7rem" },
  },
  {
    accessorKey: "legalName",
    header: "Customer",
    cell: (c) => (
      <div>
        <p className="font-medium text-fg">{c.row.original.legalName}</p>
        <p className="text-xs text-fg-3">
          {c.row.original.city} · {stateName(c.row.original.stateCode)}
        </p>
      </div>
    ),
  },
  {
    accessorKey: "gstin",
    header: "GSTIN",
    cell: (c) =>
      c.getValue() ? (
        <Mono>{c.getValue() as string}</Mono>
      ) : (
        <span className="text-xs text-fg-3">{c.row.original.gstType}</span>
      ),
  },
  {
    id: "groups",
    header: "Groups",
    accessorFn: (r) => r.groups.map((g) => g.name).join(", "),
    cell: (c) => (
      <div className="flex flex-wrap gap-1">
        {c.row.original.groups.map((g) => (
          <Badge key={g.id} dot={false}>
            {g.name}
          </Badge>
        ))}
      </div>
    ),
  },
  {
    accessorKey: "salesmanName",
    header: "Salesman",
    cell: (c) => (c.getValue() as string | null) ?? "—",
  },
  {
    accessorKey: "creditLimit",
    header: "Credit limit",
    meta: { numeric: true },
    sortingFn: (a, b) => D(a.original.creditLimit).comparedTo(D(b.original.creditLimit)),
    cell: (c) => formatINR(c.getValue() as string, { decimals: 0 }),
  },
  { accessorKey: "creditDays", header: "Days", meta: { numeric: true } },
  {
    id: "status",
    header: "Status",
    accessorFn: (r) => (!r.active ? "Inactive" : r.blocked ? "Blocked" : "Active"),
    cell: (c) => {
      const v = c.getValue() as string;
      return (
        <Badge tone={v === "Active" ? "success" : v === "Blocked" ? "danger" : "neutral"}>
          {v}
        </Badge>
      );
    },
  },
];

function CustomersPage() {
  const { data: me } = useQuery(meQuery);
  const { data, isLoading } = useQuery(customersQuery);
  const { data: groups } = useQuery(customerGroupsQuery);
  const { data: salesmen } = useQuery({
    ...salesmenQuery("all"),
    enabled: can(me, "salesmen.view"),
  });
  const search = Route.useSearch();
  const status = search.status ?? "active";
  const navigate = useNavigate({ from: Route.fullPath });
  const canCreate = can(me, "customers.manage");
  const setSearch = (patch: Partial<typeof search>) =>
    void navigate({ search: (s) => ({ ...s, ...patch }), replace: true });

  // Alt+N opens a new customer from the list.
  useEffect(() => {
    if (!canCreate) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && e.key.toLowerCase() === "n") {
        e.preventDefault();
        void navigate({ to: "/customers/new" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canCreate, navigate]);

  const all = useMemo(() => data ?? [], [data]);
  const rows = useMemo(
    () =>
      all.filter(
        (c) =>
          (status === "all" ||
            (status === "active" && c.active && !c.blocked) ||
            (status === "blocked" && c.active && c.blocked) ||
            (status === "inactive" && !c.active)) &&
          (!search.group || c.groups.some((g) => g.id === search.group)) &&
          (!search.salesman || c.salesmanId === search.salesman),
      ),
    [all, status, search.group, search.salesman],
  );
  const active = all.filter((c) => c.active);
  const blocked = active.filter((c) => c.blocked).length;
  const totalCredit = active.reduce((sum, c) => sum.plus(c.creditLimit), D(0));
  const withGst = active.filter((c) => c.gstin).length;

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Customers"
        description="Profiles, credit policy and per-metre rates."
        breadcrumbs={[{ label: "Masters" }, { label: "Customers" }]}
        actions={
          <>
            {can(me, "rates.bulk_revise") ? (
              <Button asChild variant="secondary" icon={TrendingUp}>
                <Link to="/pricing/bulk-revision">Bulk rate revision</Link>
              </Button>
            ) : null}
            {canCreate ? (
              <Button asChild variant="primary" icon={Plus} shortcut="Alt N">
                <Link to="/customers/new">New customer</Link>
              </Button>
            ) : null}
          </>
        }
      />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Total customers"
          value={all.length.toLocaleString("en-IN")}
          icon={Users}
          hint={`${active.length} active`}
        />
        <StatCard
          label="Active"
          value={(active.length - blocked).toLocaleString("en-IN")}
          icon={UserCheck}
          hint="Can place orders"
        />
        <StatCard
          label="Blocked"
          value={blocked.toLocaleString("en-IN")}
          icon={ShieldAlert}
          hint="On credit hold"
          onClick={() => setSearch({ status: "blocked" })}
        />
        <StatCard
          label="Total credit limit"
          value={formatINRCompact(totalCredit)}
          icon={Wallet}
          hint={`${withGst} GST-registered`}
        />
      </div>
      <DataTable
        caption="Customers"
        data={rows}
        loading={isLoading}
        columns={columns}
        getRowId={(c) => c.id}
        onRowClick={(c) =>
          void navigate({ to: "/customers/$customerId", params: { customerId: c.id } })
        }
        searchPlaceholder="Search name, code, GSTIN, city"
        search={search.q ?? ""}
        onSearchChange={(q) => setSearch({ q: q || undefined })}
        toolbar={
          <div className="flex flex-wrap gap-2">
            <div className="w-40">
              <Select
                aria-label="Status"
                value={status}
                onValueChange={(v) => setSearch({ status: v as typeof status })}
                options={[
                  { value: "active", label: "Active" },
                  { value: "blocked", label: "Blocked" },
                  { value: "inactive", label: "Inactive" },
                  { value: "all", label: "All statuses" },
                ]}
              />
            </div>
            <div className="w-40">
              <Select
                aria-label="Group"
                value={search.group ?? "all"}
                onValueChange={(v) => setSearch({ group: v === "all" ? undefined : v })}
                options={[
                  { value: "all", label: "All groups" },
                  ...(groups ?? []).map((g) => ({ value: g.id, label: g.name })),
                ]}
              />
            </div>
            {salesmen ? (
              <div className="w-48">
                <Select
                  aria-label="Salesman"
                  value={search.salesman ?? "all"}
                  onValueChange={(v) => setSearch({ salesman: v === "all" ? undefined : v })}
                  options={[
                    { value: "all", label: "All salesmen" },
                    ...salesmen.map((s) => ({ value: s.id, label: s.name })),
                  ]}
                />
              </div>
            ) : null}
            {rows.length !== all.length ? (
              <span className="flex items-center gap-1 text-xs text-fg-3">
                <Percent className="size-3" aria-hidden />
                {rows.length} of {all.length}
              </span>
            ) : null}
          </div>
        }
      />
    </div>
  );
}
